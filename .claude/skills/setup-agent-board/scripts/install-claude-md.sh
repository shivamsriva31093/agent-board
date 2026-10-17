#!/bin/bash
# Adds the short "Agent Board" section (../claude-md-section.md) to
# ~/.claude/CLAUDE.md so agents use the board unprompted. The section sits
# between marker comments, so re-running updates it and --uninstall removes
# it exactly. A hand-written "## Agent Board" section without markers is
# left alone.
# Usage: bash install-claude-md.sh [--dry-run] [--uninstall]

DRY_RUN=0
UNINSTALL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

FILE="$HOME/.claude/CLAUDE.md"
SECTION="$(cd "$(dirname "$0")/.." && pwd -P)/claude-md-section.md"
START='<!-- agent-board:start -->'
END='<!-- agent-board:end -->'

if [ "$UNINSTALL" = 0 ] && [ -f "$FILE" ] && ! grep -qxF "$START" "$FILE" && grep -q '^## Agent Board' "$FILE"; then
  echo "$FILE already has its own \"## Agent Board\" section; left it as is"
  exit 0
fi

# Current file minus our marked block and the blank line we put before it.
BASE=""
if [ -f "$FILE" ]; then
  BASE=$(awk -v s="$START" -v e="$END" '
    { line[NR] = $0 }
    END {
      for (i = 1; i <= NR; i++) {
        if (line[i] == s) { if (n > 0 && out[n] == "") n--; skip = 1; continue }
        if (skip && line[i] == e) { skip = 0; continue }
        if (!skip) out[++n] = line[i]
      }
      for (i = 1; i <= n; i++) print out[i]
    }' "$FILE")
fi

if [ "$UNINSTALL" = 1 ]; then
  NEW="$BASE"
elif [ -n "$BASE" ]; then
  NEW="$BASE"$'\n\n'"$START"$'\n'"$(cat "$SECTION")"$'\n'"$END"
else
  NEW="$START"$'\n'"$(cat "$SECTION")"$'\n'"$END"
fi

if [ "$DRY_RUN" = 1 ]; then
  diff <([ -f "$FILE" ] && cat "$FILE") <([ -n "$NEW" ] && printf '%s\n' "$NEW")
  exit 0
fi

mkdir -p "$(dirname "$FILE")"
if [ -f "$FILE" ]; then
  BACKUP="$FILE.bak-agent-board-$(date +%Y%m%d-%H%M%S)"
  cp "$FILE" "$BACKUP" && echo "backup: $BACKUP"
fi
if [ -n "$NEW" ]; then printf '%s\n' "$NEW" > "$FILE"; else : > "$FILE"; fi
if [ "$UNINSTALL" = 1 ]; then echo "agent-board section removed from $FILE"
else echo "agent-board section written to $FILE"; fi
