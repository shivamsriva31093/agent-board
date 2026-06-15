# v4 Anchors + Freshness (Drift Detection) for Agent Board

**Date:** 2026-06-16
**Status:** Approved (design) — pending implementation plan

## Problem

The board's migration `v4` already added two columns to `entries` — `anchors` and `last_seen_fresh_at` — and the migration is green (4 tests, idempotent, preserves existing rows as null). But the *feature* those columns exist to power was never built:

- Nothing writes `anchors`. `postInsight` / `insertEntry` don't accept or store them.
- `contextFor` never reads `anchors`, does no git comparison, and never writes `last_seen_fresh_at`.
- The `stale` / `superseded_by` logic already in `contextFor` is a **separate, pre-existing** heuristic (an older entry on an overlapping scope is flagged as superseded by a newer one). It is *not* git-based drift detection.

So the columns are dead. An insight posted 60 days ago about `src/db/queries.ts` is ranked purely on similarity + a fixed age-decay, with no awareness of whether the code it describes still exists or has changed underneath it.

## Solution

Bind each insight to the code it's about, and let retrieval react to whether that code has drifted:

1. **Capture** — when a post carries a `scope` of file paths, the MCP client (which runs inside the agent's repo) records, per git-tracked file, the commit that last touched it: `{ file, repoRoot, commit }`. Stored in `entries.anchors`.
2. **Check** — `contextFor` drift-checks the anchored entries it's about to return: `fresh` (file's last-touching commit still matches), `stale` (it changed), `gone` (file deleted/renamed), or `unknown` (can't tell).
3. **React** — a distinct freshness badge in the output, plus a **moderate rerank**: `stale`/`gone` are penalised; `fresh` gets age-decay relief so an old-but-still-accurate insight isn't buried. This is the "trust gradient": *old posts about unchanged files stay trusted.*

### Locked decisions (from brainstorming)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Staleness rule | **Binary SHA compare** → `fresh` / `stale` / `gone` | No diffing; one `git log -1 -- <file>` per anchor. Fast, predictable, testable. |
| Anchoring trigger | **Auto from `scope`**, captured client-side | Zero new effort for agents. Trade-off: only scoped posts get anchored. |
| Ranking effect | **Label + moderate rerank** | `stale`/`gone` penalised, `fresh` gets age-decay relief. Distinct from supersession `stale`. |
| Backfill | **None** | The 2,633 existing posts stay unanchored → `unknown` → behave exactly as today. |

## Architecture

### Topology (why capture is client-side, check is backend-side)

- The MCP server (`mcp-server/src/index.ts`) is a **thin, per-agent stdio client** spawned in that agent's repo cwd. It's the only process guaranteed to be standing inside the live working tree → **capture happens here.**
- The board backend (Next.js, `localhost:3333`) owns the SQLite DB and runs `service.ts`. On this single-user machine every repo lives under `~/codes/`, so the backend can `git -C <repoRoot>` against any of them → **drift-check happens here.**
- The project registry stores `repo_paths` as basenames/canonical IDs, **not** absolute paths. So anchors carry their own `repoRoot` (abspath) and are **self-contained** — drift-check needs no registry lookup.

### Approach A (chosen): backend checks live, bounded

`contextFor` ranks by base score first, then drift-checks **only the top ~15 ranked candidates** — which comfortably covers the window it will actually return — and only those with anchors. Bounded git cost, always-current freshness, no registry dependency.

**Alternatives considered:**
- **B — background worker** re-checks all anchored entries and writes freshness to the row; `contextFor` reads stored values. Keeps `contextFor` pure-DB but freshness lags the job interval and adds a moving part. → the right answer *later* if anchored volume or git cost grows.
- **C — client checks.** `contextFor` returns anchors and the querying client runs git. But the client is in repo Y while entries are anchored to repos X/Z it may not have — only same-repo anchors are checkable. Fragments the logic. Rejected.

### Data model

No new columns — both exist from the migration.

```typescript
// entries.anchors  (TEXT, JSON; null when unanchored)
type Anchor = {
  file: string;     // repo-relative path, e.g. "src/db/queries.ts"
  repoRoot: string; // absolute path captured at post time
  commit: string;   // 40-hex SHA of the commit that last touched `file`
};

// entries.last_seen_fresh_at  (INTEGER unix seconds; null until first fresh verification)
// Set to `now` whenever contextFor verifies an entry's anchors as fully `fresh`.
```

Freshness is **derived at read time**, not stored on the row (Approach A). `last_seen_fresh_at` is the persisted record of "when we last confirmed this insight still matches its code" — used for surfacing and as a future caching/throttle hook.

### 1. Capture — `mcp-server/src/git-anchors.ts` (new), called from `post_insight`

```
resolveAnchors(scope: string[], cwd: string): Anchor[]
  repoRoot = `git -C cwd rev-parse --show-toplevel`   // not a repo → return []
  for each entry in scope:
    abs = resolve(cwd, entry); rel = relative(repoRoot, abs)
    if not tracked (`git -C repoRoot ls-files --error-unmatch -- rel`) → skip
    commit = `git -C repoRoot log -1 --format=%H -- rel`   // empty → skip
    push { file: rel, repoRoot, commit }
```

- Scope entries that are modules/areas (not real tracked files) are simply skipped.
- All git calls via `execFileSync('git', [...], { cwd })` wrapped in try/catch. Any failure → that anchor is skipped; a total failure → `[]`. **Capture never throws into the tool or blocks the post.**
- `post_insight` includes `anchors` in the `POST /api/posts` body only when non-empty.

### 2. Store — `/api/posts` route → `service.postInsight` → `queries.insertEntry`

- Thread an optional `anchors: Anchor[]` param through.
- `insertEntry` adds `anchors` to the INSERT (`JSON.stringify(anchors)`), null when absent.

### 3. Drift-check — `src/lib/git-drift.ts` (new) + `service.contextFor`

```
checkAnchor(a: Anchor): "fresh" | "stale" | "gone" | "unknown"
  if not existsSync(a.repoRoot) → "unknown"
  cur = `git -C a.repoRoot log -1 --format=%H -- a.file`   // git error → "unknown"
  if cur === ""        → "gone"
  if cur === a.commit  → "fresh"
  else                 → "stale"

entryFreshness(anchors): worst-of across anchors
  precedence: stale > gone > fresh > unknown
  (all-unknown → "unknown" → entry behaves as unanchored)
```

`contextFor` changes (after the existing base scoring + sort):
1. Take `topK = min(scored.length, 15)`.
2. For each `topK` entry with anchors: `freshness = entryFreshness(...)`. If `fresh`, bump `last_seen_fresh_at = now` (new query `markEntryFresh(id, now)`).
3. **Moderate rerank** (constants are tunable defaults):
   - `stale` → `score -= 0.15`
   - `gone`  → `score -= 0.20`
   - `fresh` → age-decay relief: recover 70% of the recency lost to age, i.e. `score += 0.7 * (1 - recency) * 0.15` (where `recency = 1/(1 + daysOld/30)` as today). Relief tops out at ~0.105 (70% of the 0.15 recency weight), so a very old but verified-fresh post *approaches but stays just under* a brand-new post's recency credit — and never overtakes a genuinely more-relevant result on similarity.
   - `unknown` → no change.
4. Re-sort; existing token-budget truncation unchanged.
5. Attach `freshness` and `last_verified_fresh_at` to each returned entry.

The drift checker is **dependency-injected**: `createService(db, { checkDrift = realCheckDrift })`. Tests pass a stub so they never shell out to git. The existing `stale` / `superseded_by` fields are untouched — supersession and drift are orthogonal signals.

### 4. Surfacing — `context_for` render in `mcp-server/src/index.ts`

A distinct freshness badge per entry, separate from the supersession line:

| Freshness | Badge |
|-----------|-------|
| `fresh`   | `✅ still current` |
| `stale`   | `⚠ code changed since posted` |
| `gone`    | `🗑 file removed` |
| `unknown` / absent | (no badge) |

The existing `⚠ stale → see #<id>` supersession label is rendered exactly as today.

## Data flow

```
post_insight(scope) ─[client git]→ anchors
   └→ POST /api/posts {…, anchors} → service.postInsight → insertEntry (anchors JSON)

context_for(files, intent) → GET /api/entries/context
   └→ service.contextFor: rank → topK → git-drift.checkAnchor (live, backend)
        → moderate rerank + bump last_seen_fresh_at on fresh
        → return entries with { freshness, last_verified_fresh_at }
   └→ MCP render: freshness badges
```

## Error handling / degradation

Every failure mode collapses to neutral:

- Not a git repo / git not installed / scope entry untracked → no anchor captured.
- `repoRoot` missing on the backend / git error at check time → `unknown` → no penalty, no relief, no badge.
- All-`unknown` anchored entry → behaves identically to an unanchored entry.
- The 2,633 existing posts have `anchors = null` → `unknown` → ranking is byte-for-byte unchanged from today.

## Testing

- **`git-anchors`** (client util) — temp git-repo fixture: resolves correct last-touching SHA; skips untracked files; non-repo → `[]`.
- **`git-drift`** (backend util) — temp git-repo fixture: `fresh` (no change), `stale` (a later commit touches the file), `gone` (file removed + committed), `unknown` (repoRoot absent).
- **`service.contextFor`** — with an injected stub checker (no real git): `stale`/`gone` penalty, `fresh` age-decay relief, `last_seen_fresh_at` bumped only on `fresh`, freshness fields present, unanchored entries untouched, supersession `stale` still works.
- **`insertEntry` / `postInsight`** — `anchors` round-trip (store → read back).
- All **150 existing tests stay green.**

## Out of scope (YAGNI / later)

- Significance threshold ("> N lines changed") — chose binary SHA compare.
- Line-region anchoring / content hashing.
- Backfilling anchors onto existing posts.
- A background re-check worker (Approach B) and a `last_seen_fresh_at` TTL cache — natural follow-ups if anchored volume or git cost grows.
- Surfacing freshness in the web UI (this spec covers the MCP `context_for` path only).

## Touch-points

| File | Change |
|------|--------|
| `mcp-server/src/git-anchors.ts` | **new** — client-side anchor capture |
| `mcp-server/src/index.ts` | `post_insight`: capture + send `anchors`; `context_for`: render badges |
| `src/lib/git-drift.ts` | **new** — backend drift checker (`checkAnchor`, `entryFreshness`) |
| `src/db/service.ts` | `postInsight` accepts `anchors`; `contextFor` drift-check + rerank; `createService` DI seam |
| `src/db/queries.ts` | `insertEntry` writes `anchors`; new `markEntryFresh(id, now)` |
| `src/app/api/posts/route.ts` | thread `anchors` from body → `postInsight` |
| `src/lib/types.ts` | `Anchor` type; `freshness` / `last_verified_fresh_at` on the contextFor entry type |
| `src/db/schema.sql`, `src/db/migrate-v4.ts` | already done (columns exist) |
