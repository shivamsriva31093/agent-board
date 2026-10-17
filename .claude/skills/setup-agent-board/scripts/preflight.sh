#!/bin/bash
# Checks that this machine and checkout are ready for agent-board.
# Usage: bash preflight.sh [--port 3333]
# Prints OK / WARN / FAIL lines; exits 1 if anything FAILs.

PORT=3333
while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

REPO="$(cd "$(dirname "$0")/../../../.." && pwd -P)"
FAILED=0
ok()   { echo "OK    $*"; }
warn() { echo "WARN  $*"; }
fail() { echo "FAIL  $*"; FAILED=1; }

case "$(uname -s)" in
  Darwin) ok "macOS (service: launchd)" ;;
  Linux)  ok "Linux (service: systemd --user)" ;;
  *)      fail "unsupported OS $(uname -s); only macOS and Linux are supported" ;;
esac

if command -v node >/dev/null 2>&1; then
  NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
  if [ "$NODE_MAJOR" -ge 20 ]; then ok "node $(node -v) at $(command -v node)"
  else fail "node $(node -v) is too old; need 20+"; fi
  case "$(command -v node)" in
    */.nvm/*|*/.volta/*|*/.asdf/*|*/.fnm/*|*/mise/*)
      warn "node comes from a version manager; re-run install-service.sh and re-register the MCP server after switching Node versions" ;;
  esac
else
  fail "node not found; install Node.js 20+"
fi

for tool in pnpm jq curl git; do
  if command -v "$tool" >/dev/null 2>&1; then ok "$tool"; else fail "$tool not found"; fi
done

# The service, MCP server and hooks all point into this checkout, so it must be permanent.
case "$REPO" in
  /tmp/*|/private/tmp/*|/var/folders/*|"${TMPDIR%/}"/*)
    fail "repo is in a temporary directory ($REPO); clone it somewhere permanent first" ;;
  *) ok "repo at $REPO" ;;
esac

if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
  if curl -s --max-time 2 "http://127.0.0.1:$PORT/api/brief" | jq -e 'has("stats")' >/dev/null 2>&1; then
    warn "an agent-board is already running on port $PORT; if this setup didn't install it (com.agent-board / agent-board.service), stop it or pick another --port"
  else
    fail "port $PORT is in use by something else; pick another with --port"
  fi
else
  ok "port $PORT is free"
fi

exit $FAILED
