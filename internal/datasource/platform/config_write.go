package platform

import (
	"context"
	"errors"
	"thcpn-gin/internal/apperr"

	"github.com/google/uuid"
)

// UnknownSourceWrite marks an external commit whose outcome cannot safely be retried.
type UnknownSourceWrite struct{ Err error }

func (e *UnknownSourceWrite) Error() string { return e.Err.Error() }
func (e *UnknownSourceWrite) Unwrap() error { return e.Err }

// WriteConfig tracks source and platform commits independently. apply must not write the source again.
func (s *Service) WriteConfig(ctx context.Context, sourceID uuid.UUID, input UpdateDeviceConfigInput, write func() (DeviceConfig, ConfigAudit, error), apply func(DeviceConfig) (UpdateDeviceConfigResult, error)) (response UpdateDeviceConfigResult, err error) {
	operationID, err := s.BeginSourceOperation(ctx, sourceID, &input.DeviceID, "config_update", "running", input, input.ActorUserID)
	if err != nil {
		return response, err
	}
	state := &ConfigWriteState{OperationID: operationID, Source: "pending", Platform: "pending", Device: "unknown"}
	status := "failed"
	var operationErr error
	defer func() {
		if operationErr == nil {
			operationErr = err
		}
		response.WriteState = state
		if recordErr := s.FinishSourceOperation(operationID, status, state, operationErr); recordErr != nil && err == nil {
			response.Warnings = append(response.Warnings, QueryWarning{Code: "operation_record_failed", Message: "操作结果记录未更新，请重新核对配置状态。"})
		}
	}()
	config, audit, err := write()
	if err != nil {
		var unknown *UnknownSourceWrite
		if errors.As(err, &unknown) {
			state.Source = "unknown"
			status = "unknown"
			err = apperr.Wrap(apperr.KindDataSource, "配置写入结果未知，请核对源端配置；操作 "+operationID.String(), err)
		} else {
			state.Source = "failed"
		}
		return response, err
	}
	state.Source = "accepted"
	response, err = apply(config)
	response.DeviceID = input.DeviceID
	response.DataSourceID = sourceID
	response.ExternalDeviceID = config.DeviceID
	response.Config = config
	response.Audit = audit
	if err != nil {
		state.Platform = "failed"
		status = "partial"
		operationErr = err
		response.Warnings = append(response.Warnings, QueryWarning{Code: "platform_sync_failed", Message: "源配置已保存，但平台同步失败；请重新同步配置，不要重复提交。"})
		// Keep the original error for the deferred record update while returning a successful partial result.
		response.WriteState = state
		return response, nil
	}
	state.Platform = "synced"
	status = "completed"
	return response, nil
}
