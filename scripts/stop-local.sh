#!/usr/bin/env bash
set -eu

project_root="$(cd "$1" && pwd -P)"
echo "Stopping THCPN application processes in $project_root"

# A port listener may belong to OrbStack or another project. Match both the
# application command and its working directory before sending a signal.
for task_pid in $(pgrep -f '(^go run ./cmd/(api|worker)$|/go-build/[^ ]+/(api|worker)$|/exe/(api|worker)$|/vite([ /]|$))' || true); do
  task_cwd="$(lsof -a -p "$task_pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
  case "$task_cwd" in
    "$project_root"|"$project_root/app"|"$project_root/app/"*)
      echo "  stopping application pid $task_pid"
      kill "$task_pid" 2>/dev/null || true
      ;;
  esac
done
