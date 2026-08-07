package permission

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/db/sqlc"
	"thcpn-gin/internal/httpx"
)

type CatalogService struct {
	queries *sqlc.Queries
}

type CatalogHandler struct {
	service *CatalogService
}

type PermissionDefinition struct {
	Code         string `json:"code"`
	Name         string `json:"name"`
	ResourceType string `json:"resource_type"`
	Action       string `json:"action"`
	Group        string `json:"group"`
}

type PermissionGroup struct {
	Code  string   `json:"code"`
	Name  string   `json:"name"`
	Codes []string `json:"codes"`
}

type PermissionTemplate struct {
	Code            string   `json:"code"`
	Name            string   `json:"name"`
	PermissionCodes []string `json:"permission_codes"`
}

type CatalogResponse struct {
	Permissions []PermissionDefinition `json:"permissions"`
	Groups      []PermissionGroup      `json:"groups"`
	Templates   []PermissionTemplate   `json:"templates"`
}

func NewCatalogService(db *pgxpool.Pool) *CatalogService {
	return &CatalogService{queries: sqlc.New(db)}
}

func NewCatalogHandler(service *CatalogService) *CatalogHandler {
	return &CatalogHandler{service: service}
}

func (h *CatalogHandler) Catalog(c *gin.Context) {
	if h.service == nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInternal, "permission catalog is not configured"))
		return
	}
	result, err := h.service.Catalog(c.Request.Context())
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (s *CatalogService) Catalog(ctx context.Context) (CatalogResponse, error) {
	if s.queries == nil {
		return CatalogResponse{}, apperr.New(apperr.KindInternal, "permission catalog store is not configured")
	}
	permissionRows, err := s.queries.ListPermissions(ctx)
	if err != nil {
		return CatalogResponse{}, apperr.Wrap(apperr.KindInternal, "list permissions", err)
	}
	templateRows, err := s.queries.ListSystemRolePermissionTemplates(ctx)
	if err != nil {
		return CatalogResponse{}, apperr.Wrap(apperr.KindInternal, "list permission templates", err)
	}

	groups := defaultPermissionGroups()
	groupByCode := make(map[string]int, len(groups))
	for i := range groups {
		groupByCode[groups[i].Code] = i
	}

	permissions := make([]PermissionDefinition, 0, len(permissionRows))
	for _, row := range permissionRows {
		group := permissionGroupFor(row.Code, row.ResourceType)
		permissions = append(permissions, PermissionDefinition{
			Code:         row.Code,
			Name:         row.Name,
			ResourceType: row.ResourceType,
			Action:       row.Action,
			Group:        group,
		})
		if idx, ok := groupByCode[group]; ok {
			groups[idx].Codes = append(groups[idx].Codes, row.Code)
		}
	}

	templates := make([]PermissionTemplate, 0, len(templateRows))
	for _, row := range templateRows {
		templates = append(templates, PermissionTemplate{
			Code:            row.Code,
			Name:            row.Name,
			PermissionCodes: row.PermissionCodes,
		})
	}

	return CatalogResponse{
		Permissions: permissions,
		Groups:      groups,
		Templates:   templates,
	}, nil
}

func defaultPermissionGroups() []PermissionGroup {
	return []PermissionGroup{
		{Code: "workspace_member", Name: "成员与工作区"},
		{Code: "project_site", Name: "项目与站点"},
		{Code: "device", Name: "设备"},
		{Code: "telemetry", Name: "遥测"},
		{Code: "media", Name: "媒体"},
		{Code: "dataset", Name: "数据集"},
		{Code: "processing", Name: "数据处理"},
		{Code: "share_service", Name: "分享与售后"},
		{Code: "audit", Name: "审计"},
	}
}

func permissionGroupFor(code string, resourceType string) string {
	switch resourceType {
	case "member", "workspace":
		return "workspace_member"
	case "project", "site":
		return "project_site"
	case "device":
		return "device"
	case "telemetry":
		return "telemetry"
	case "media":
		return "media"
	case "dataset":
		return "dataset"
	case "processing":
		return "processing"
	case "share", "service_access":
		return "share_service"
	case "audit":
		return "audit"
	default:
		_ = code
		return "workspace_member"
	}
}
