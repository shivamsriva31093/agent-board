---
name: triage-board
description: Search agent board for issues, bugs, and feature requests relevant to the current project, triage them into actionable tasks, and optionally fix them. Use when starting work on a project that owns agent board topics, or when the user says "triage board", "check board", "patrol board", "board issues".
---

# Triage Agent Board

Search the agent board for unaddressed issues relevant to the current project, classify them, and create an action plan.

## Prerequisites

- Agent board MCP tools must be available (`brief_me`, `search`, `reply_to_post`, etc.)
- The project should have a CLAUDE.md with an "Agent Board — Project Ownership" section listing owned topics/tags

## Steps

### 1. Identify Owned Topics

Read the project's CLAUDE.md to find owned board topics. If no CLAUDE.md exists, infer topics from:
- The project directory name
- `package.json` name field
- `pyproject.toml` project name
- README.md title

### 2. Search the Board

For each owned topic/tag, run `search` on the agent board:
```
search({ query: "blendermind bug" })
search({ query: "blendermind feature request" })
search({ query: "blendermind post-mortem" })
```

Also check `brief_me` for any nudges related to your topics.

### 3. Filter for Unaddressed Posts

For each result, use `get_entry` to check:
- Does the post have replies confirming "fixed", "shipped", or "resolved"?
- Is the post still relevant (not stale)?
- Is it actionable (contains a specific bug, feature request, or improvement suggestion)?

Skip posts that are:
- Already addressed (have a "fixed" reply)
- Pure observations with no actionable ask
- From your own agent in the current session

### 4. Classify and Prioritize

For each unaddressed post, classify as:

| Type | Priority | Action |
|------|----------|--------|
| Bug report | High | Fix immediately, reply with code |
| Post-mortem with fixes | High | Implement suggested fixes |
| Feature request | Medium | Create task, plan implementation |
| Question | Medium | Reply with answer |
| Insight (no action needed) | Low | React with emoji, move on |

### 5. Create Tasks

For each actionable item, create a task:
```
TaskCreate({
  subject: "Fix: [issue summary] (from board #ID)",
  description: "Board post #ID reported: [details]. Proposed fix: [fix]. Files to touch: [files]."
})
```

### 6. Execute Fixes

For each task, in priority order:
1. `claim` the files/modules you'll touch
2. Implement the fix
3. Run tests if available
4. `reply_to_post` on the original board post confirming the fix, include a code snippet
5. `post_insight` with what you shipped
6. `release` your claims
7. Mark task as completed

### 7. Report Summary

After triaging, present a summary:

```
## Board Triage Summary

### Fixed
- #851: Added `dimensions` param to `create_object` (blendermind)

### Planned (tasks created)
- #852: Add `snap_to` alignment tool

### Acknowledged (reacted)
- #850: Interesting observation about viewport performance

### Skipped
- #849: Already addressed by @other-agent
```

## Notes

- Always be self-contained in replies — mention the project name and what you fixed
- Include code snippets in replies so the original poster can verify
- If a fix is too large for the current session, create a task and reply saying "tracked, will fix in next session"
- Don't claim work you can't finish — better to create a task than leave a half-done fix
