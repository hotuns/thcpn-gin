package device

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/db/sqlc"
)

type Service struct {
	db      *pgxpool.Pool
	queries *sqlc.Queries
}

type Device struct {
	ID           uuid.UUID  `json:"id"`
	AssignmentID uuid.UUID  `json:"assignment_id"`
	WorkspaceID  uuid.UUID  `json:"workspace_id"`
	ProjectID    *uuid.UUID `json:"project_id,omitempty"`
	SiteID       *uuid.UUID `json:"site_id,omitempty"`
	ProductID    *string    `json:"product_id,omitempty"`
	SerialNo     string     `json:"serial_no"`
	Name         string     `json:"name"`
	Status       string     `json:"status"`
	ActivatedAt  *time.Time `json:"activated_at,omitempty"`
	AssignedBy   *uuid.UUID `json:"assigned_by,omitempty"`
	AssignedAt   *time.Time `json:"assigned_at,omitempty"`
	Capabilities []string   `json:"capabilities"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

type DeviceOperation struct {
	ID            uuid.UUID       `json:"id"`
	WorkspaceID   uuid.UUID       `json:"workspace_id"`
	DeviceID      uuid.UUID       `json:"device_id"`
	OperationType string          `json:"operation_type"`
	Status        string          `json:"status"`
	Request       json.RawMessage `json:"request"`
	RequestedBy   uuid.UUID       `json:"requested_by"`
	CreatedAt     time.Time       `json:"created_at"`
	UpdatedAt     time.Time       `json:"updated_at"`
}

type CreateInput struct {
	WorkspaceID  uuid.UUID
	ProjectID    *uuid.UUID
	SiteID       *uuid.UUID
	ProductID    string
	SerialNo     string
	Name         string
	Capabilities []string
	ActorUserID  uuid.UUID
}

type ListInput struct {
	WorkspaceID uuid.UUID
	ProjectID   *uuid.UUID
	SiteID      *uuid.UUID
}

type UpdateInput struct {
	DeviceID     uuid.UUID
	ProjectID    *uuid.UUID
	SiteID       *uuid.UUID
	ProductID    *string
	SerialNo     *string
	Name         *string
	Status       *string
	Capabilities *[]string
}

type CalibrationInput struct {
	DeviceID        uuid.UUID
	CalibrationType string
	Parameters      json.RawMessage
	ActorUserID     uuid.UUID
}

type FirmwareUpgradeInput struct {
	DeviceID        uuid.UUID
	FirmwareVersion string
	PackageURI      string
	Checksum        string
	ScheduledAt     *time.Time
	ActorUserID     uuid.UUID
}

type TransferInput struct {
	DeviceID                   uuid.UUID
	TargetWorkspaceID          uuid.UUID
	ProjectID                  *uuid.UUID
	SiteID                     *uuid.UUID
	TransferHistoricalDatasets bool
	ConfirmDatasetPolicy       bool
	ActorUserID                uuid.UUID
}

type UnbindInput struct {
	DeviceID    uuid.UUID
	ActorUserID uuid.UUID
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{
		db:      db,
		queries: sqlc.New(db),
	}
}

func (s *Service) Create(ctx context.Context, input CreateInput) (Device, error) {
	serialNo := strings.TrimSpace(input.SerialNo)
	name := strings.TrimSpace(input.Name)
	if input.WorkspaceID == uuid.Nil {
		return Device{}, apperr.New(apperr.KindInvalidArgument, "workspace id is required")
	}
	if input.ActorUserID == uuid.Nil {
		return Device{}, apperr.New(apperr.KindInvalidArgument, "actor user id is required")
	}
	if input.SiteID != nil && input.ProjectID == nil {
		return Device{}, apperr.New(apperr.KindInvalidArgument, "project_id is required when site_id is set")
	}
	if serialNo == "" {
		return Device{}, apperr.New(apperr.KindInvalidArgument, "serial_no is required")
	}
	if name == "" {
		return Device{}, apperr.New(apperr.KindInvalidArgument, "device name is required")
	}
	capabilities, err := normalizeCapabilities(input.Capabilities)
	if err != nil {
		return Device{}, err
	}

	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Device{}, apperr.Wrap(apperr.KindInternal, "begin create device transaction", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback(ctx)
		}
	}()

	q := s.queries.WithTx(tx)
	created, err := q.CreateDevice(ctx, sqlc.CreateDeviceParams{
		ProductID: nullableTrimmedString(input.ProductID),
		SerialNo:  serialNo,
		Name:      name,
	})
	if err != nil {
		return Device{}, mapWriteError(err, "create device")
	}
	assignment, err := q.CreateDeviceAssignment(ctx, sqlc.CreateDeviceAssignmentParams{
		DeviceID:    created.ID,
		WorkspaceID: input.WorkspaceID,
		ProjectID:   input.ProjectID,
		SiteID:      input.SiteID,
		AssignedBy:  &input.ActorUserID,
	})
	if err != nil {
		return Device{}, mapWriteError(err, "assign device")
	}

	if err := replaceCapabilities(ctx, q, created.ID, capabilities); err != nil {
		return Device{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return Device{}, apperr.Wrap(apperr.KindInternal, "commit create device transaction", err)
	}
	committed = true

	return fromSQLWithAssignment(created, assignment, capabilities), nil
}

func (s *Service) Get(ctx context.Context, deviceID uuid.UUID) (Device, error) {
	if deviceID == uuid.Nil {
		return Device{}, apperr.New(apperr.KindInvalidArgument, "device id is required")
	}

	row, err := s.queries.GetDeviceWithActiveAssignment(ctx, deviceID)
	if err != nil {
		return Device{}, mapNotFoundOrInternal(err, "device not found")
	}
	capabilities, err := s.queries.ListDeviceCapabilities(ctx, deviceID)
	if err != nil {
		return Device{}, apperr.Wrap(apperr.KindInternal, "list device capabilities", err)
	}

	return fromAssignedSQL(row, capabilities), nil
}

func (s *Service) List(ctx context.Context, input ListInput) ([]Device, error) {
	if input.WorkspaceID == uuid.Nil {
		return nil, apperr.New(apperr.KindInvalidArgument, "workspace id is required")
	}
	if input.SiteID != nil && input.ProjectID == nil {
		return nil, apperr.New(apperr.KindInvalidArgument, "project_id is required when site_id is set")
	}

	var err error
	items := make([]Device, 0)
	switch {
	case input.SiteID != nil:
		rows, err := s.queries.ListDevicesBySite(ctx, sqlc.ListDevicesBySiteParams{
			WorkspaceID: input.WorkspaceID,
			SiteID:      input.SiteID,
		})
		if err == nil {
			for _, row := range rows {
				capabilities, err := s.queries.ListDeviceCapabilities(ctx, row.ID)
				if err != nil {
					return nil, apperr.Wrap(apperr.KindInternal, "list device capabilities", err)
				}
				items = append(items, fromSiteRow(row, capabilities))
			}
		}
	case input.ProjectID != nil:
		rows, err := s.queries.ListDevicesByProject(ctx, sqlc.ListDevicesByProjectParams{
			WorkspaceID: input.WorkspaceID,
			ProjectID:   input.ProjectID,
		})
		if err == nil {
			for _, row := range rows {
				capabilities, err := s.queries.ListDeviceCapabilities(ctx, row.ID)
				if err != nil {
					return nil, apperr.Wrap(apperr.KindInternal, "list device capabilities", err)
				}
				items = append(items, fromProjectRow(row, capabilities))
			}
		}
	default:
		rows, err := s.queries.ListDevicesByWorkspace(ctx, input.WorkspaceID)
		if err == nil {
			for _, row := range rows {
				capabilities, err := s.queries.ListDeviceCapabilities(ctx, row.ID)
				if err != nil {
					return nil, apperr.Wrap(apperr.KindInternal, "list device capabilities", err)
				}
				items = append(items, fromWorkspaceRow(row, capabilities))
			}
		}
	}
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list devices", err)
	}
	return items, nil
}

func (s *Service) Update(ctx context.Context, input UpdateInput) (Device, error) {
	if input.DeviceID == uuid.Nil {
		return Device{}, apperr.New(apperr.KindInvalidArgument, "device id is required")
	}

	current, err := s.queries.GetDeviceWithActiveAssignment(ctx, input.DeviceID)
	if err != nil {
		return Device{}, mapNotFoundOrInternal(err, "device not found")
	}

	projectID := current.ProjectID
	if input.ProjectID != nil {
		projectID = input.ProjectID
	}
	siteID := current.SiteID
	if input.SiteID != nil {
		siteID = input.SiteID
	}
	if siteID != nil && projectID == nil {
		return Device{}, apperr.New(apperr.KindInvalidArgument, "project_id is required when site_id is set")
	}
	if input.ProductID != nil || input.SerialNo != nil || input.Name != nil || input.Status != nil || input.Capabilities != nil {
		return Device{}, apperr.New(apperr.KindInvalidArgument, "only project_id and site_id can be updated by workspace users")
	}

	capabilities, err := s.queries.ListDeviceCapabilities(ctx, input.DeviceID)
	if err != nil {
		return Device{}, apperr.Wrap(apperr.KindInternal, "list device capabilities", err)
	}

	assignment, err := s.queries.UpdateDeviceAssignment(ctx, sqlc.UpdateDeviceAssignmentParams{
		ID:        current.AssignmentID,
		ProjectID: projectID,
		SiteID:    siteID,
	})
	if err != nil {
		return Device{}, mapWriteError(err, "update device")
	}
	device, err := s.queries.GetDevice(ctx, input.DeviceID)
	if err != nil {
		return Device{}, mapNotFoundOrInternal(err, "device not found")
	}
	return fromSQLWithAssignment(device, assignment, capabilities), nil
}

func (s *Service) RequestCalibration(ctx context.Context, input CalibrationInput) (DeviceOperation, error) {
	requestJSON, err := buildCalibrationRequest(input.CalibrationType, input.Parameters)
	if err != nil {
		return DeviceOperation{}, err
	}
	return s.createOperation(ctx, createOperationInput{
		DeviceID:           input.DeviceID,
		OperationType:      "calibration",
		RequiredCapability: "calibratable",
		RequestJSON:        requestJSON,
		ActorUserID:        input.ActorUserID,
	})
}

func (s *Service) RequestFirmwareUpgrade(ctx context.Context, input FirmwareUpgradeInput) (DeviceOperation, error) {
	requestJSON, err := buildFirmwareUpgradeRequest(input)
	if err != nil {
		return DeviceOperation{}, err
	}
	return s.createOperation(ctx, createOperationInput{
		DeviceID:           input.DeviceID,
		OperationType:      "firmware_upgrade",
		RequiredCapability: "firmware_update",
		RequestJSON:        requestJSON,
		ActorUserID:        input.ActorUserID,
	})
}

func (s *Service) Transfer(ctx context.Context, input TransferInput) (Device, error) {
	if input.DeviceID == uuid.Nil {
		return Device{}, apperr.New(apperr.KindInvalidArgument, "device id is required")
	}
	if input.TargetWorkspaceID == uuid.Nil {
		return Device{}, apperr.New(apperr.KindInvalidArgument, "target_workspace_id is required")
	}
	if input.ActorUserID == uuid.Nil {
		return Device{}, apperr.New(apperr.KindInvalidArgument, "actor user id is required")
	}
	if input.SiteID != nil && input.ProjectID == nil {
		return Device{}, apperr.New(apperr.KindInvalidArgument, "project_id is required when site_id is set")
	}
	if !input.ConfirmDatasetPolicy {
		return Device{}, apperr.New(apperr.KindInvalidArgument, "confirm_dataset_policy is required")
	}
	if input.TransferHistoricalDatasets {
		return Device{}, apperr.New(apperr.KindInvalidArgument, "historical dataset transfer is not supported")
	}

	current, err := s.queries.GetActiveDeviceAssignment(ctx, input.DeviceID)
	if err != nil {
		return Device{}, mapNotFoundOrInternal(err, "device not found")
	}
	if current.WorkspaceID == input.TargetWorkspaceID {
		return Device{}, apperr.New(apperr.KindInvalidArgument, "target workspace must differ from current workspace")
	}
	if err := s.validateTransferTarget(ctx, input.TargetWorkspaceID, input.ProjectID, input.SiteID); err != nil {
		return Device{}, err
	}

	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Device{}, apperr.Wrap(apperr.KindInternal, "begin transfer device transaction", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback(ctx)
		}
	}()

	q := s.queries.WithTx(tx)
	if _, err := q.CloseActiveDeviceAssignment(ctx, sqlc.CloseActiveDeviceAssignmentParams{
		DeviceID: input.DeviceID,
		Status:   "transferred",
	}); err != nil {
		return Device{}, mapWriteError(err, "close active device assignment")
	}
	assignment, err := q.CreateDeviceAssignment(ctx, sqlc.CreateDeviceAssignmentParams{
		DeviceID:    input.DeviceID,
		WorkspaceID: input.TargetWorkspaceID,
		ProjectID:   input.ProjectID,
		SiteID:      input.SiteID,
		AssignedBy:  &input.ActorUserID,
	})
	if err != nil {
		return Device{}, mapWriteError(err, "transfer device")
	}
	device, err := q.GetDevice(ctx, input.DeviceID)
	if err != nil {
		return Device{}, mapNotFoundOrInternal(err, "device not found")
	}
	capabilities, err := q.ListDeviceCapabilities(ctx, input.DeviceID)
	if err != nil {
		return Device{}, apperr.Wrap(apperr.KindInternal, "list device capabilities", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return Device{}, apperr.Wrap(apperr.KindInternal, "commit transfer device transaction", err)
	}
	committed = true
	return fromSQLWithAssignment(device, assignment, capabilities), nil
}

func (s *Service) Unbind(ctx context.Context, input UnbindInput) error {
	if input.DeviceID == uuid.Nil {
		return apperr.New(apperr.KindInvalidArgument, "device id is required")
	}
	if input.ActorUserID == uuid.Nil {
		return apperr.New(apperr.KindInvalidArgument, "actor user id is required")
	}

	_, err := s.queries.CloseActiveDeviceAssignment(ctx, sqlc.CloseActiveDeviceAssignmentParams{
		DeviceID: input.DeviceID,
		Status:   "removed",
	})
	if err != nil {
		return mapNotFoundOrInternal(err, "active device assignment not found")
	}
	return nil
}

func (s *Service) validateTransferTarget(ctx context.Context, workspaceID uuid.UUID, projectID *uuid.UUID, siteID *uuid.UUID) error {
	if _, err := s.queries.GetWorkspace(ctx, workspaceID); err != nil {
		return mapNotFoundOrInternal(err, "target workspace not found")
	}
	if projectID != nil {
		project, err := s.queries.GetProject(ctx, *projectID)
		if err != nil {
			return mapNotFoundOrInternal(err, "target project not found")
		}
		if project.WorkspaceID != workspaceID {
			return apperr.New(apperr.KindInvalidArgument, "target project does not belong to target workspace")
		}
	}
	if siteID != nil {
		site, err := s.queries.GetSite(ctx, *siteID)
		if err != nil {
			return mapNotFoundOrInternal(err, "target site not found")
		}
		if site.WorkspaceID != workspaceID {
			return apperr.New(apperr.KindInvalidArgument, "target site does not belong to target workspace")
		}
		if projectID != nil && site.ProjectID != *projectID {
			return apperr.New(apperr.KindInvalidArgument, "target site does not belong to target project")
		}
	}
	return nil
}

type createOperationInput struct {
	DeviceID           uuid.UUID
	OperationType      string
	RequiredCapability string
	RequestJSON        []byte
	ActorUserID        uuid.UUID
}

func (s *Service) createOperation(ctx context.Context, input createOperationInput) (DeviceOperation, error) {
	if input.DeviceID == uuid.Nil {
		return DeviceOperation{}, apperr.New(apperr.KindInvalidArgument, "device id is required")
	}
	if input.ActorUserID == uuid.Nil {
		return DeviceOperation{}, apperr.New(apperr.KindInvalidArgument, "actor user id is required")
	}
	if !isValidDeviceOperationType(input.OperationType) {
		return DeviceOperation{}, apperr.New(apperr.KindInvalidArgument, "invalid device operation type")
	}
	if len(input.RequestJSON) == 0 {
		input.RequestJSON = []byte("{}")
	}

	assignment, err := s.queries.GetActiveDeviceAssignment(ctx, input.DeviceID)
	if err != nil {
		return DeviceOperation{}, mapNotFoundOrInternal(err, "active device assignment not found")
	}
	capabilities, err := s.queries.ListDeviceCapabilities(ctx, input.DeviceID)
	if err != nil {
		return DeviceOperation{}, apperr.Wrap(apperr.KindInternal, "list device capabilities", err)
	}
	if input.RequiredCapability != "" && !hasCapability(capabilities, input.RequiredCapability) {
		return DeviceOperation{}, apperr.New(apperr.KindInvalidArgument, "device does not support "+input.RequiredCapability)
	}

	created, err := s.queries.CreateDeviceOperation(ctx, sqlc.CreateDeviceOperationParams{
		WorkspaceID:   assignment.WorkspaceID,
		DeviceID:      input.DeviceID,
		OperationType: input.OperationType,
		RequestJson:   input.RequestJSON,
		RequestedBy:   input.ActorUserID,
	})
	if err != nil {
		return DeviceOperation{}, mapWriteError(err, "create device operation")
	}
	return operationFromSQL(created), nil
}

func buildCalibrationRequest(calibrationType string, parameters json.RawMessage) ([]byte, error) {
	calibrationType = strings.TrimSpace(calibrationType)
	if calibrationType == "" {
		return nil, apperr.New(apperr.KindInvalidArgument, "calibration_type is required")
	}

	request := map[string]any{
		"calibration_type": calibrationType,
	}
	normalizedParameters, err := normalizeJSONObject(parameters, "parameters")
	if err != nil {
		return nil, err
	}
	if len(normalizedParameters) > 0 {
		request["parameters"] = json.RawMessage(normalizedParameters)
	}
	return marshalJSONObject(request, "calibration request")
}

func buildFirmwareUpgradeRequest(input FirmwareUpgradeInput) ([]byte, error) {
	firmwareVersion := strings.TrimSpace(input.FirmwareVersion)
	if firmwareVersion == "" {
		return nil, apperr.New(apperr.KindInvalidArgument, "firmware_version is required")
	}

	request := map[string]any{
		"firmware_version": firmwareVersion,
	}
	if packageURI := strings.TrimSpace(input.PackageURI); packageURI != "" {
		request["package_uri"] = packageURI
	}
	if checksum := strings.TrimSpace(input.Checksum); checksum != "" {
		request["checksum"] = checksum
	}
	if input.ScheduledAt != nil {
		if input.ScheduledAt.IsZero() {
			return nil, apperr.New(apperr.KindInvalidArgument, "scheduled_at is invalid")
		}
		request["scheduled_at"] = input.ScheduledAt.UTC().Format(time.RFC3339Nano)
	}
	return marshalJSONObject(request, "firmware upgrade request")
}

func normalizeJSONObject(value json.RawMessage, name string) ([]byte, error) {
	trimmed := bytes.TrimSpace(value)
	if len(trimmed) == 0 {
		return nil, nil
	}
	var object map[string]any
	if err := json.Unmarshal(trimmed, &object); err != nil || object == nil {
		return nil, apperr.New(apperr.KindInvalidArgument, name+" must be a JSON object")
	}
	normalized, err := json.Marshal(object)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "marshal "+name, err)
	}
	return normalized, nil
}

func marshalJSONObject(value map[string]any, name string) ([]byte, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "marshal "+name, err)
	}
	return encoded, nil
}

func isValidDeviceStatus(status string) bool {
	switch status {
	case "active", "disabled", "retired":
		return true
	default:
		return false
	}
}

func isValidDeviceOperationType(operationType string) bool {
	switch operationType {
	case "calibration", "firmware_upgrade":
		return true
	default:
		return false
	}
}

func normalizeCapabilities(values []string) ([]string, error) {
	seen := map[string]struct{}{}
	capabilities := make([]string, 0, len(values))
	for _, raw := range values {
		value := strings.TrimSpace(raw)
		if value == "" {
			continue
		}
		if !isValidCapability(value) {
			return nil, apperr.New(apperr.KindInvalidArgument, "invalid device capability")
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		capabilities = append(capabilities, value)
	}
	return capabilities, nil
}

func isValidCapability(value string) bool {
	switch value {
	case "telemetry", "image_capture", "video_stream", "ptz_control", "remote_command", "configurable", "calibratable", "firmware_update", "edge_storage":
		return true
	default:
		return false
	}
}

func hasCapability(capabilities []string, required string) bool {
	for _, capability := range capabilities {
		if capability == required {
			return true
		}
	}
	return false
}

func replaceCapabilities(ctx context.Context, q *sqlc.Queries, deviceID uuid.UUID, capabilities []string) error {
	if err := q.DeleteDeviceCapabilities(ctx, deviceID); err != nil {
		return apperr.Wrap(apperr.KindInternal, "delete device capabilities", err)
	}
	for _, capability := range capabilities {
		if _, err := q.AddDeviceCapability(ctx, sqlc.AddDeviceCapabilityParams{
			DeviceID:       deviceID,
			CapabilityCode: capability,
		}); err != nil {
			return mapWriteError(err, "add device capability")
		}
	}
	return nil
}

func operationFromSQL(model sqlc.DeviceOperation) DeviceOperation {
	return DeviceOperation{
		ID:            model.ID,
		WorkspaceID:   model.WorkspaceID,
		DeviceID:      model.DeviceID,
		OperationType: model.OperationType,
		Status:        model.Status,
		Request:       json.RawMessage(model.RequestJson),
		RequestedBy:   model.RequestedBy,
		CreatedAt:     pgTime(model.CreatedAt),
		UpdatedAt:     pgTime(model.UpdatedAt),
	}
}

func fromSQL(model sqlc.Device, capabilities []string) Device {
	return Device{
		ID:           model.ID,
		ProductID:    model.ProductID,
		SerialNo:     model.SerialNo,
		Name:         model.Name,
		Status:       model.Status,
		ActivatedAt:  pgTimePtr(model.ActivatedAt),
		Capabilities: capabilities,
		CreatedAt:    pgTime(model.CreatedAt),
		UpdatedAt:    pgTime(model.UpdatedAt),
	}
}

func fromSQLWithAssignment(model sqlc.Device, assignment sqlc.DeviceAssignment, capabilities []string) Device {
	device := fromSQL(model, capabilities)
	device.AssignmentID = assignment.ID
	device.WorkspaceID = assignment.WorkspaceID
	device.ProjectID = assignment.ProjectID
	device.SiteID = assignment.SiteID
	device.AssignedBy = assignment.AssignedBy
	device.AssignedAt = pgTimePtr(assignment.AssignedAt)
	return device
}

func fromAssignedSQL(model sqlc.GetDeviceWithActiveAssignmentRow, capabilities []string) Device {
	return Device{
		ID:           model.ID,
		AssignmentID: model.AssignmentID,
		WorkspaceID:  model.WorkspaceID,
		ProjectID:    model.ProjectID,
		SiteID:       model.SiteID,
		ProductID:    model.ProductID,
		SerialNo:     model.SerialNo,
		Name:         model.Name,
		Status:       model.Status,
		ActivatedAt:  pgTimePtr(model.ActivatedAt),
		AssignedBy:   model.AssignedBy,
		AssignedAt:   pgTimePtr(model.AssignedAt),
		Capabilities: capabilities,
		CreatedAt:    pgTime(model.CreatedAt),
		UpdatedAt:    pgTime(model.UpdatedAt),
	}
}

func fromWorkspaceRow(model sqlc.ListDevicesByWorkspaceRow, capabilities []string) Device {
	return Device{
		ID:           model.ID,
		AssignmentID: model.AssignmentID,
		WorkspaceID:  model.WorkspaceID,
		ProjectID:    model.ProjectID,
		SiteID:       model.SiteID,
		ProductID:    model.ProductID,
		SerialNo:     model.SerialNo,
		Name:         model.Name,
		Status:       model.Status,
		ActivatedAt:  pgTimePtr(model.ActivatedAt),
		AssignedBy:   model.AssignedBy,
		AssignedAt:   pgTimePtr(model.AssignedAt),
		Capabilities: capabilities,
		CreatedAt:    pgTime(model.CreatedAt),
		UpdatedAt:    pgTime(model.UpdatedAt),
	}
}

func fromProjectRow(model sqlc.ListDevicesByProjectRow, capabilities []string) Device {
	return Device{
		ID:           model.ID,
		AssignmentID: model.AssignmentID,
		WorkspaceID:  model.WorkspaceID,
		ProjectID:    model.ProjectID,
		SiteID:       model.SiteID,
		ProductID:    model.ProductID,
		SerialNo:     model.SerialNo,
		Name:         model.Name,
		Status:       model.Status,
		ActivatedAt:  pgTimePtr(model.ActivatedAt),
		AssignedBy:   model.AssignedBy,
		AssignedAt:   pgTimePtr(model.AssignedAt),
		Capabilities: capabilities,
		CreatedAt:    pgTime(model.CreatedAt),
		UpdatedAt:    pgTime(model.UpdatedAt),
	}
}

func fromSiteRow(model sqlc.ListDevicesBySiteRow, capabilities []string) Device {
	return Device{
		ID:           model.ID,
		AssignmentID: model.AssignmentID,
		WorkspaceID:  model.WorkspaceID,
		ProjectID:    model.ProjectID,
		SiteID:       model.SiteID,
		ProductID:    model.ProductID,
		SerialNo:     model.SerialNo,
		Name:         model.Name,
		Status:       model.Status,
		ActivatedAt:  pgTimePtr(model.ActivatedAt),
		AssignedBy:   model.AssignedBy,
		AssignedAt:   pgTimePtr(model.AssignedAt),
		Capabilities: capabilities,
		CreatedAt:    pgTime(model.CreatedAt),
		UpdatedAt:    pgTime(model.UpdatedAt),
	}
}

func nullableTrimmedString(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func pgTimePtr(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}
	return &value.Time
}

func pgTime(value pgtype.Timestamptz) time.Time {
	if !value.Valid {
		return time.Time{}
	}
	return value.Time
}

func mapWriteError(err error, message string) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23505":
			return apperr.Wrap(apperr.KindConflict, "resource already exists", err)
		case "23503", "23514":
			return apperr.Wrap(apperr.KindInvalidArgument, message, err)
		}
	}
	return apperr.Wrap(apperr.KindInternal, message, err)
}

func mapNotFoundOrInternal(err error, message string) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return apperr.New(apperr.KindNotFound, message)
	}
	return apperr.Wrap(apperr.KindInternal, message, err)
}
