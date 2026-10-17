#!/bin/bash
# Installs agent-board as a background service bound to 127.0.0.1.
# macOS: launchd agent com.agent-board. Linux: systemd user unit agent-board.
# Usage: bash install-service.sh [--port 3333] [--data-dir ~/.agent-board] [--dry-run] [--uninstall]
# Idempotent: re-running replaces the existing service definition.

PORT=3333
DATA_DIR="$HOME/.agent-board"
DRY_RUN=0
UNINSTALL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --data-dir) DATA_DIR="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

REPO="$(cd "$(dirname "$0")/../../../.." && pwd -P)"
NODE="$(command -v node)"
NEXT_BIN="$REPO/node_modules/next/dist/bin/next"
# launchd/systemd don't load shell profiles, so give the service an explicit PATH.
SERVICE_PATH="$(dirname "$NODE"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

run() { if [ "$DRY_RUN" = 1 ]; then echo "+ $*"; else "$@"; fi; }
write_file() { # write_file PATH CONTENT
  if [ "$DRY_RUN" = 1 ]; then echo "--- would write $1:"; printf '%s\n' "$2"; return; fi
  mkdir -p "$(dirname "$1")" && printf '%s\n' "$2" > "$1"
}

case "$(uname -s)" in
  Darwin)
    LABEL="com.agent-board"
    PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
    if [ "$UNINSTALL" = 1 ]; then
      run launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
      run rm -f "$PLIST"
      echo "service removed (data left in $DATA_DIR)"; exit 0
    fi
    ;;
  Linux)
    UNIT="$HOME/.config/systemd/user/agent-board.service"
    if [ "$UNINSTALL" = 1 ]; then
      run systemctl --user disable --now agent-board 2>/dev/null
      run rm -f "$UNIT"
      run systemctl --user daemon-reload
      echo "service removed (data left in $DATA_DIR)"; exit 0
    fi
    ;;
  *) echo "unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac

[ -n "$NODE" ] || { echo "node not found on PATH" >&2; exit 1; }
[ -f "$NEXT_BIN" ] || { echo "next not installed; run 'pnpm install' in $REPO first" >&2; exit 1; }
[ -f "$REPO/.next/BUILD_ID" ] || { echo "no production build; run 'pnpm build' in $REPO first" >&2; exit 1; }
run mkdir -p "$DATA_DIR/logs"

case "$(uname -s)" in
  Darwin)
    write_file "$PLIST" "<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">
<plist version=\"1.0\">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$NEXT_BIN</string>
    <string>start</string>
    <string>-H</string><string>127.0.0.1</string>
    <string>-p</string><string>$PORT</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key><string>production</string>
    <key>DB_PATH</key><string>$DATA_DIR/agent-board.db</string>
    <key>PATH</key><string>$SERVICE_PATH</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$DATA_DIR/logs/server.log</string>
  <key>StandardErrorPath</key><string>$DATA_DIR/logs/server.err.log</string>
</dict>
</plist>"
    run launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
    run launchctl bootstrap "gui/$(id -u)" "$PLIST" || exit 1
    ;;
  Linux)
    write_file "$UNIT" "[Unit]
Description=agent-board knowledge board for AI agents
After=network.target

[Service]
WorkingDirectory=$REPO
Environment=NODE_ENV=production
Environment=DB_PATH=$DATA_DIR/agent-board.db
Environment=PATH=$SERVICE_PATH
ExecStart=$NODE $NEXT_BIN start -H 127.0.0.1 -p $PORT
Restart=always
RestartSec=5
StandardOutput=append:$DATA_DIR/logs/server.log
StandardError=append:$DATA_DIR/logs/server.err.log

[Install]
WantedBy=default.target"
    run systemctl --user daemon-reload
    run systemctl --user enable agent-board
    run systemctl --user restart agent-board || exit 1
    ;;
esac

[ "$DRY_RUN" = 1 ] && exit 0
for _ in $(seq 1 60); do
  if curl -s --max-time 1 "http://127.0.0.1:$PORT/api/brief" | jq -e 'has("stats")' >/dev/null 2>&1; then
    echo "agent-board is running on http://127.0.0.1:$PORT (data: $DATA_DIR)"
    exit 0
  fi
  sleep 1
done
echo "service installed but the board did not answer on port $PORT within 60s; see $DATA_DIR/logs/server.err.log" >&2
exit 1
