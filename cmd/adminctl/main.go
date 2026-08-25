package main

import (
	"context"
	"flag"
	"fmt"
	"os"

	"thcpn-gin/internal/config"
	"thcpn-gin/internal/db"
	"thcpn-gin/internal/systemadmin"
)

func main() {
	if len(os.Args) < 2 || os.Args[1] != "create" {
		fmt.Fprintln(os.Stderr, "usage: adminctl create --name NAME --email EMAIL [--password PASSWORD]")
		os.Exit(2)
	}
	flags := flag.NewFlagSet("create", flag.ExitOnError)
	name := flags.String("name", "", "administrator name")
	email := flags.String("email", "", "administrator email")
	password := flags.String("password", "", "initial password; generated when omitted")
	_ = flags.Parse(os.Args[2:])
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
func fatal(err error) { fmt.Fprintln(os.Stderr, err); os.Exit(1) }
