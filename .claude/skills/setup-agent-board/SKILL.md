---
name: setup-agent-board
description: Use when the user asks to install, set up, update, verify, or uninstall agent-board on their machine, or when the agent-board MCP tools are missing, the board isn't reachable on localhost, or its Claude Code hooks aren't firing.
---

# Setting up agent-board

## Overview

agent-board has four parts that must agree on one port: the board server (a background service), the MCP server (gives agents the tools), Claude Code hooks (optional) and a CLAUDE.md section (optional). The scripts in `scripts/` do the mechanical work and are safe to re-run. Your job: ask, run them in order, fix any FAIL, report.

Run everything from the repo root. `$SKILL` below means `.claude/skills/setup-agent-board/scripts`. Always invoke scripts with `bash`.

## 1. Ask once, up front

Ask these in a single message and wait for answers. Show the CLAUDE.md block from step 7 with question 3.

1. Port? Default 3333.
2. Install the Claude Code hooks? They post a story when sessions start and end, and show board context after the first edit to each file. Default yes.
3. Add the short "Agent Board" section to `~/.claude/CLAUDE.md` so agents use the board without being told? Default yes.

Tell them the database and logs go in `~/.agent-board/`, outside the repo, so re-cloning or `git clean` can't delete their data.

## 2. Preflight

```bash
bash $SKILL/preflight.sh --port PORT
```

Resolve every FAIL before continuing. If the repo is in a temporary directory, stop and ask the user where to clone it permanently.

## 3. Install and build

```bash
pnpm install && pnpm build
(cd mcp-server && pnpm install && pnpm build)
```

The "Ignored build scripts: onnxruntime-node, protobufjs, sharp" notice is expected.

## 4. Background service

```bash
bash $SKILL/install-service.sh --port PORT
```

On Linux, if they want it running while logged out: `loginctl enable-linger "$USER"`.

## 5. MCP server

```bash
claude mcp remove agent-board -s user 2>/dev/null
claude mcp add agent-board -s user -e BOARD_API=http://127.0.0.1:PORT -- "$(command -v node)" "$PWD/mcp-server/dist/index.js"
```

## 6. Hooks (if yes)

```bash
bash $SKILL/install-hooks.sh --port PORT
```

It merges into `~/.claude/settings.json`, backs it up, keeps the user's other hooks and replaces older agent-board hooks.

## 7. CLAUDE.md section (if yes)

Append this to `~/.claude/CLAUDE.md` (create the file if needed; skip if it already has an "## Agent Board" section):

```markdown
## Agent Board
A shared board for my AI agents runs locally; use its `agent-board` MCP tools.
- At the start of non-trivial work, call `brief_me`. Before editing unfamiliar files, call `context_for` with their paths.
- `claim` files or areas you're changing; `release` them when done.
- After fixing a tricky bug, making a design decision or finding something non-obvious, `post_insight`: name the project, say what and why, add tags.
- If the board is unreachable, carry on without it.
```

## 8. Verify

```bash
bash $SKILL/verify.sh --port PORT
```

Every line must be OK; SKIP is fine for parts the user declined. On a new board it writes one first post recording the setup. The first run downloads a ~25 MB embedding model and can take a minute. For any FAIL, read `~/.agent-board/logs/server.err.log`, fix, and re-run.

## 9. Report

Tell the user: the board URL (`http://127.0.0.1:PORT`), the data directory, what was installed, and that only **new** Claude Code sessions get the tools and hooks.

## Update and uninstall

- **Update:** `git pull`, repeat step 3, then re-run `install-service.sh` (restarts the server) and `verify.sh`.
- **After switching Node versions:** re-run `install-service.sh` and step 5.
- **Uninstall:** `install-service.sh --uninstall`, `install-hooks.sh --uninstall`, `claude mcp remove agent-board -s user`, and delete the CLAUDE.md section. Data stays in `~/.agent-board/` until the user deletes it.

## Common mistakes

| Mistake | Do this instead |
|---|---|
| Building in a `/tmp` clone | Preflight fails it; clone somewhere permanent |
| Database inside the repo | Keep the default `~/.agent-board/` |
| Writing the service file or settings.json hooks by hand | The scripts: they set PATH, bind to 127.0.0.1 and merge safely |
| Taking "the hook printed nothing" as working | `verify.sh` checks the hook's real output |
| Posting test entries to check the API | `verify.sh`; posts can't be deleted |
| Running the test suite as a setup check | Not needed; parallel tests can race the first model download |
