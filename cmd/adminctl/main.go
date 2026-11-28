package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/config"
	"thcpn-gin/internal/db"
	"thcpn-gin/internal/systemadmin"
	"thcpn-gin/internal/wallboard"
)

func main() {
	if len(os.Args) < 2 {
		usage()
	}
	switch os.Args[1] {
	case "create":
		runCreate(os.Args[2:])
	case "onprem-init":
		runOnPremInit(os.Args[2:])
	default:
		usage()
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage:")
	fmt.Fprintln(os.Stderr, "  adminctl create --name NAME --email EMAIL [--password PASSWORD]")
	fmt.Fprintln(os.Stderr, "  adminctl onprem-init [--workspace-id UUID] [--workspace-name NAME] [--admin-email EMAIL] [--admin-password PASSWORD] [--user-email EMAIL] [--user-password PASSWORD]")
	os.Exit(2)
}

func runCreate(args []string) {
	flags := flag.NewFlagSet("create", flag.ExitOnError)
	name := flags.String("name", "", "administrator name")
	email := flags.String("email", "", "administrator email")
	password := flags.String("password", "", "initial password; generated when omitted")
	_ = flags.Parse(args)
	cfg, err := config.Load()
	if err != nil {
		fatal(err)
	}
	ctx := context.Background()
	pool, err := db.NewPostgres(ctx, cfg.Database.PlatformDSN)
	if err != nil {
		fatal(err)
	}
	defer pool.Close()
	item, generated, err := systemadmin.NewService(pool).Create(ctx, *name, *email, *password)
	if err != nil {
		fatal(err)
	}
	fmt.Printf("administrator created\nid: %s\nemail: %s\npassword: %s\n", item.ID, item.Email, generated)
}

func runOnPremInit(args []string) {
	flags := flag.NewFlagSet("onprem-init", flag.ExitOnError)
	wsIDFlag := flags.String("workspace-id", envDefault("DEPLOYMENT_WORKSPACE_ID", ""), "default workspace UUID")
	wsNameFlag := flags.String("workspace-name", envDefault("INIT_WORKSPACE_NAME", "默认工作空间"), "default workspace name")
	adminNameFlag := flags.String("admin-name", envDefault("INIT_ADMIN_NAME", "系统管理员"), "initial admin name")
	adminEmailFlag := flags.String("admin-email", envDefault("INIT_ADMIN_EMAIL", ""), "initial admin email")
	adminPasswordFlag := flags.String("admin-password", envDefault("INIT_ADMIN_PASSWORD", ""), "initial admin password")
	userNameFlag := flags.String("user-name", envDefault("INIT_USER_NAME", "平台用户"), "initial platform user name")
	userEmailFlag := flags.String("user-email", envDefault("INIT_USER_EMAIL", ""), "initial platform user email (defaults to admin email)")
	userPasswordFlag := flags.String("user-password", envDefault("INIT_USER_PASSWORD", ""), "initial platform user password (defaults to admin password)")
	_ = flags.Parse(args)

	cfg, err := config.Load()
	if err != nil {
		fatal(err)
	}
	ctx := context.Background()
	pool, err := db.NewPostgres(ctx, cfg.Database.PlatformDSN)
	if err != nil {
		fatal(err)
	}
	defer pool.Close()

	adminEmail := strings.ToLower(strings.TrimSpace(*adminEmailFlag))
	if adminEmail == "" {
		fatal(errors.New("admin email is required (--admin-email or INIT_ADMIN_EMAIL)"))
	}
	adminPassword := *adminPasswordFlag
	userEmail := strings.ToLower(strings.TrimSpace(*userEmailFlag))
	if userEmail == "" {
		userEmail = adminEmail
	}
	userPassword := *userPasswordFlag
	if userPassword == "" {
		userPassword = adminPassword
	}

	// 1. Ensure initial system administrator (idempotent).
	var existingAdminID uuid.UUID
	err = pool.QueryRow(ctx, `SELECT id FROM system_admins WHERE lower(email) = $1`, adminEmail).Scan(&existingAdminID)
	if errors.Is(err, pgx.ErrNoRows) {
		item, _, createErr := systemadmin.NewService(pool).Create(ctx, *adminNameFlag, adminEmail, adminPassword)
		if createErr != nil {
			fatal(fmt.Errorf("create initial administrator: %w", createErr))
		}
		fmt.Printf("administrator created: %s (%s)\n", item.Email, item.ID)
	} else if err != nil {
		fatal(fmt.Errorf("check administrator: %w", err))
	} else {
		fmt.Printf("administrator exists: %s (%s)\n", adminEmail, existingAdminID)
	}

	// 2. Ensure initial platform user (idempotent).
	ownerUserID, userCreated, err := ensureInitialUser(ctx, pool, *userNameFlag, userEmail, userPassword)
	if err != nil {
		fatal(fmt.Errorf("ensure initial user: %w", err))
	}
	if userCreated {
		fmt.Printf("platform user created: %s (%s)\n", userEmail, ownerUserID)
	} else {
		fmt.Printf("platform user exists: %s (%s)\n", userEmail, ownerUserID)
	}

	// 3. Ensure default single workspace (idempotent).
	wsIDStr := strings.TrimSpace(*wsIDFlag)
	if wsIDStr == "" {
		wsIDStr = strings.TrimSpace(cfg.Deployment.WorkspaceID)
	}
	var workspaceID uuid.UUID
	if wsIDStr != "" {
		workspaceID, err = uuid.Parse(wsIDStr)
		if err != nil || workspaceID == uuid.Nil {
			fatal(fmt.Errorf("invalid workspace UUID: %q", wsIDStr))
		}
	} else {
		workspaceID = uuid.New()
	}
	wsCreated, err := ensureDefaultWorkspace(ctx, pool, workspaceID, *wsNameFlag, ownerUserID)
	if err != nil {
		fatal(fmt.Errorf("ensure default workspace: %w", err))
	}
	if wsCreated {
		fmt.Printf("default workspace created: %s (%s)\n", *wsNameFlag, workspaceID)
	} else {
		fmt.Printf("default workspace exists: %s\n", workspaceID)
	}

	// 4. Sync wallboard templates and ensure a default Atlas view exists.
	wbService := wallboard.NewService(pool, nil, nil, nil)
	if err := wbService.Sync(ctx); err != nil {
		fatal(fmt.Errorf("sync wallboard templates: %w", err))
	}
	wbCreated, wbID, err := ensureDefaultAtlas(ctx, pool, workspaceID, ownerUserID)
	if err != nil {
		fatal(fmt.Errorf("ensure default atlas: %w", err))
	}
	if wbCreated {
		fmt.Printf("default atlas created: %s\n", wbID)
	} else {
		fmt.Printf("default atlas exists: %s\n", wbID)
	}
}

func ensureInitialUser(ctx context.Context, pool *pgxpool.Pool, name, email, password string) (uuid.UUID, bool, error) {
	var existingID uuid.UUID
	err := pool.QueryRow(ctx, `SELECT id FROM users WHERE lower(email) = $1`, email).Scan(&existingID)
	if err == nil {
		return existingID, false, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, false, err
	}
	if strings.TrimSpace(password) == "" {
		return uuid.Nil, false, errors.New("initial user password is required (--user-password or INIT_USER_PASSWORD or INIT_ADMIN_PASSWORD)")
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		return uuid.Nil, false, err
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return uuid.Nil, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var id uuid.UUID
	if err := tx.QueryRow(ctx, `INSERT INTO users (name, email, status) VALUES ($1, $2, 'active') RETURNING id`, strings.TrimSpace(name), email).Scan(&id); err != nil {
		return uuid.Nil, false, err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO user_credentials (user_id, password_hash, must_change_password) VALUES ($1, $2, false)`, id, hash); err != nil {
		return uuid.Nil, false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return uuid.Nil, false, err
	}
	return id, true, nil
}

func ensureDefaultWorkspace(ctx context.Context, pool *pgxpool.Pool, workspaceID uuid.UUID, name string, ownerUserID uuid.UUID) (bool, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var existingID uuid.UUID
	created := false
	err = tx.QueryRow(ctx, `SELECT id FROM workspaces WHERE id = $1`, workspaceID).Scan(&existingID)
	if errors.Is(err, pgx.ErrNoRows) {
		if _, err := tx.Exec(ctx, `INSERT INTO workspaces (id, type, organization_type, name, owner_user_id, status) VALUES ($1, 'organization', 'institution', $2, $3, 'active')`, workspaceID, strings.TrimSpace(name), ownerUserID); err != nil {
			return false, err
		}
		created = true
	} else if err != nil {
		return false, err
	}

	var memberID uuid.UUID
	err = tx.QueryRow(ctx, `SELECT id FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`, workspaceID, ownerUserID).Scan(&memberID)
	if errors.Is(err, pgx.ErrNoRows) {
		var roleID uuid.UUID
		if err := tx.QueryRow(ctx, `SELECT id FROM roles WHERE code = 'owner' AND workspace_id IS NULL`).Scan(&roleID); err != nil {
			return false, err
		}
		if err := tx.QueryRow(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role_id, scope_type, scope_id, template_code) VALUES ($1, $2, $3, 'workspace', $1, 'owner') RETURNING id`, workspaceID, ownerUserID, roleID).Scan(&memberID); err != nil {
			return false, err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO workspace_member_permissions (member_id, permission_id) SELECT $1, rp.permission_id FROM role_permissions rp WHERE rp.role_id = $2 ON CONFLICT DO NOTHING`, memberID, roleID); err != nil {
			return false, err
		}
	} else if err != nil {
		return false, err
	}

	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	return created, nil
}

func ensureDefaultAtlas(ctx context.Context, pool *pgxpool.Pool, workspaceID, actorID uuid.UUID) (bool, uuid.UUID, error) {
	var existingID uuid.UUID
	err := pool.QueryRow(ctx, `SELECT id FROM wallboards WHERE workspace_id = $1 AND status = 'active' ORDER BY created_at ASC LIMIT 1`, workspaceID).Scan(&existingID)
	if err == nil {
		return false, existingID, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return false, uuid.Nil, err
	}
	id := uuid.New()
	cfgJSON, _ := json.Marshal(map[string]any{
		"device_ids":   []string{},
		"trend_hours":  24,
		"layout":       "map",
		"presentation": "deep-blue",
	})
	if _, err := pool.Exec(ctx, `
		INSERT INTO wallboards (id, workspace_id, name, template_code, template_version, config_json, status, created_by)
		VALUES ($1, $2, '默认一张图', 'atlas-tech', 1, $3, 'active', $4)
	`, id, workspaceID, cfgJSON, actorID); err != nil {
		return false, uuid.Nil, err
	}
	return true, id, nil
}

func envDefault(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func fatal(err error) { fmt.Fprintln(os.Stderr, err); os.Exit(1) }
