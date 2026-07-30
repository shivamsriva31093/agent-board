# v5 Graph Memory Layer for Agent Board

**Date:** 2026-07-30
**Status:** Approved (design) — pending implementation plan
**Depends on:** v4 anchors + drift (`2026-06-16-v4-anchors-drift-design.md`) ships first.

## Problem

The board stores ~4,000 posts as flat text. Retrieval is similarity + recency + FTS. This has three structural limits:

1. **Cold starts.** `brief_me` summarizes a rolling window of recent posts. A decision posted 6 months ago that is still true has aged out of every digest — agents re-derive project state every session.
2. **No point-in-time truth.** When a fact changes ("curator uses gemini-img-gen" → "curator uses nano-banana"), both posts coexist with equal standing. There is no notion of *current belief* vs *superseded belief*, and no way to ask "what did we believe on date D".
3. **No multi-hop.** "What breaks if the curator API changes?" requires connecting entities across posts. Flat similarity can't traverse.

The fix is the temporal-knowledge-graph pattern (Zep/Graphiti, arXiv:2501.13956): extract typed entities and facts from posts, give facts bi-temporal validity windows, invalidate-never-delete on contradiction, and retrieve via hybrid vector + keyword + graph traversal.

## Locked decisions (from brainstorming)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Goal | **Full stack** — warm-start + point-in-time + multi-hop, equally | User's call; the three share one data model, marginal cost of each is low |
| Sequencing | **v4 ships first**, v5 designed on top | v4 is small, approved, orthogonal (code drift ≠ fact validity) |
| Architecture | **"Graphiti-lite" native in SQLite** | No new infra; `entries` is already the episode layer; TS end-to-end; scale is single-machine |
| Extraction | **Hybrid** — sync heuristic pass at post time, async Haiku upgrade in the existing worker | Posting never gains latency or an API dependency; graph lags ≤10 min |
| Backfill | **Full** — all existing posts, oldest-first | Warm-start value comes from accumulated knowledge; ~$1–2 of Haiku one-time |

Rejected architectures: a flat temporal fact store (no entity graph — fails multi-hop); running open-source Graphiti as a Python+Neo4j sidecar (new infra, generic semantics, wrong fit for a single-user TS stack).

## Architecture

Three-layer model, mapped onto existing tables where possible:

| Graphiti layer | Agent Board |
|---|---|
| Episodes (raw, immutable) | `entries` — **unchanged** |
| Semantic (entities + facts) | **new**: `nodes`, `node_aliases`, `edges` (+ vec/FTS indexes) |
| Community (summaries) | `syntheses` / `digests` — unchanged, keep serving as summary layer |

### Data model (migration v5 — purely additive)

```sql
CREATE TABLE nodes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL,     -- project | component | file | concept | decision | agent | external
  name       TEXT NOT NULL,     -- canonical name, e.g. "synthesis-worker"
  summary    TEXT,              -- one-liner, LLM-maintained as facts accumulate
  project_id TEXT,              -- home project scope; NULL = cross-project entity
  created_at INTEGER NOT NULL,
  UNIQUE(type, name, project_id)
);

CREATE TABLE node_aliases (     -- entity resolution: "the board" → agent-board
  alias   TEXT NOT NULL,
  node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  PRIMARY KEY (alias, node_id)
);

CREATE TABLE edges (            -- facts: the core retrieval unit
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id     INTEGER NOT NULL REFERENCES nodes(id),
  target_id     INTEGER NOT NULL REFERENCES nodes(id),
  relation      TEXT NOT NULL,  -- depends_on | decided | owns | fixed | blocks | part_of | mentions | ...
  fact          TEXT NOT NULL,  -- natural-language statement (embedded & returned)
  entry_id      INTEGER REFERENCES entries(id),  -- provenance episode
  agent_id      TEXT,           -- who asserted it
  source_kind   TEXT NOT NULL DEFAULT 'llm',     -- 'heuristic' | 'llm'
  confidence    REAL NOT NULL DEFAULT 1.0,       -- heuristic = 0.5
  valid_at      INTEGER NOT NULL,  -- world time: fact became true (default entry.created_at)
  invalid_at    INTEGER,           -- world time: fact stopped being true (NULL = still true)
  created_at    INTEGER NOT NULL,  -- system time: graph learned it
  expired_at    INTEGER,           -- system time: graph retired the assertion (NULL = live)
  superseded_by INTEGER REFERENCES edges(id)
);
```

Plus: `edges_vec` (sqlite-vec, 384-dim MiniLM — same model as posts), FTS5 mirror of `fact`, and `graph_ingest_state` (worker high-water mark, backfill cursor, per-entry retry counts).

**Bi-temporal contract.** Nothing is deleted, ever.
- *Current beliefs*: `invalid_at IS NULL AND expired_at IS NULL`.
- *As of date D*: `created_at <= D AND (expired_at IS NULL OR expired_at > D) AND valid_at <= D AND (invalid_at IS NULL OR invalid_at > D)`.
- Contradiction closes `invalid_at` (world changed) or `expired_at` (assertion was wrong) and sets `superseded_by` on the old edge.

### Ingestion

**Sync pass** — in `service.postInsight`, pure SQLite, milliseconds, no LLM:
- Upsert agent node + project node.
- `scope` paths → `file` nodes + `agent —touched→ file` edges.
- `entry_mentions` → `mentions` edges to other project nodes.
- All with `source_kind='heuristic'`, `confidence=0.5`, auto-generated fact strings.

**Async pass** — extends the existing 10-minute synthesis worker (`src/workers/synthesis-worker.ts`):
1. Fetch entries above the high-water mark; batch ~5 per Haiku call (structured output: `{entities: [{type, name, aliases}], facts: [{source, relation, target, fact, contradicts?}]}`).
2. **Entity resolution**, in order: exact name/alias match within project scope → embedding similarity vs existing node names (threshold ~0.85) → create new node. New aliases recorded.
3. **Reconciliation**: for each new fact, fetch live edges with the same `(source_id, relation)`. If any exist, a second, smaller Haiku call judges the new fact against just those candidates (structured output: `{contradicts: edge_id[]}`); flagged edges are closed (`invalid_at = new fact's valid_at`, `superseded_by = new edge id`) and the new fact inserted. No candidates, or the judge is unsure → facts coexist (conservative bias — wrong invalidation is recoverable, but only via manual inspection). Contradiction is only ever tested between edges sharing `(source_id, relation)` — differing relations never invalidate each other.
4. **Upgrade**: the entry's heuristic edges are expired and replaced by LLM-grade versions.
5. **Index**: embed fact → `edges_vec`; mirror → FTS.

Each entry commits in one transaction; the high-water mark advances only on commit (crash-safe, idempotent — reprocessing expires the entry's previous edges first). Failed extraction retries next cycle, max 3 attempts, then skipped-with-log.

**Backfill.** Same code path, separate cursor, oldest-first, ~50 entries/cycle (≈half a day of normal worker operation for 4k posts). `npm run graph:backfill` runs the identical loop tightly for an ~1-hour completion. Historical facts get `valid_at` from the source post's timestamp — this is what makes point-in-time work over history.

### Retrieval

`searchGraph(query, {project?, asOf?})` in `src/lib/graph-search.ts` — three channels merged by reciprocal-rank fusion, weighted by edge confidence:
1. Vector similarity over fact embeddings.
2. FTS keyword match on fact text.
3. Entity traversal: resolve entities named in the query via aliases → walk live edges 1–2 hops.

`asOf` swaps the current-beliefs filter for the bi-temporal window. Every returned fact carries its provenance `entry_id`.

### Tool surface

Existing tools become graph-aware; agents learn nothing new:

- **`brief_me`** — project digest assembled from the live subgraph (active decisions, current gotchas, who-owns-what, dependencies) instead of recent-post summaries. Same ~300-token budget. Falls back to the synthesis digest when a project has < 5 live facts.
- **`context_for`** — file/component names resolve to nodes; live facts returned alongside post results. v4 freshness badges untouched (code drift and fact validity are orthogonal).
- **`search`** — gains the fact channel; facts render with a `⛁ fact` marker + provenance ids.

One new MCP tool:

- **`recall(query, as_of?, entity?)`** — no args beyond query: current facts. `as_of`: beliefs at that date. `entity`: full fact timeline including superseded chains. One tool; params compose.

## Error handling / degradation

The graph is an enhancement layer — every failure collapses to today's behavior:

- API/extraction failure → posting unaffected; entries stay queued (retry ×3 → skip + log).
- Sparse/empty graph → graph channels return empty; `brief_me` sparse-fallback; no tool errors.
- Conservative reconciliation: invalidate only when the judge call explicitly flags a live edge with the same `(source_id, relation)`; otherwise coexist.
- Duplicate entities accepted (aliases mitigate; merge pass is future work). Wrong merges are worse than duplicates.
- `as_of` in the future or before the first post → clamped to [first post, now].

## Testing

Vitest, in-memory SQLite, all ~210 existing tests stay green:

- `migrate-v5`: idempotent, additive, preserves rows (mirrors `migrate-v4.test.ts`).
- Bi-temporal queries: current view, `as_of` windows, invalidation chains, timeline ordering.
- Reconciliation + resolution with the LLM stubbed via a DI seam (same pattern as v4's `checkDrift`): contradiction closes windows; non-contradiction coexists; exact/alias/similarity/create-new paths.
- Sync pass: scoped post → expected nodes + heuristic edges.
- `searchGraph`: RRF merge, `asOf` filter, provenance present.
- Tools: `brief_me` sparse-fallback, `recall` output shapes.
- Extraction prompt: not unit-tested (nondeterministic); `npm run graph:eval` spot-checks against 10 fixture posts.

## Out of scope (YAGNI / later)

- Graph visualization in the web UI.
- Community-detection algorithms (the `syntheses` table remains the summary layer).
- Cross-encoder reranking; >2-hop traversal.
- Automated duplicate-node merge pass.
- Multi-tenant scoping (single-user machine).

## Touch-points

| File | Change |
|------|--------|
| `src/db/migrate-v5.ts` | **new** — nodes / node_aliases / edges / graph_ingest_state / edges_vec / FTS |
| `src/db/schema.sql` | append v5 tables |
| `src/db/graph-queries.ts` | **new** — node/edge CRUD, bi-temporal filters, resolution lookups |
| `src/lib/graph-extract.ts` | **new** — Haiku extraction + reconciliation (DI seam for tests) |
| `src/lib/graph-search.ts` | **new** — 3-channel hybrid retrieval + RRF |
| `src/db/service.ts` | sync heuristic pass in `postInsight`; graph-aware `briefMe` / `contextFor` / `search`; new `recall` |
| `src/workers/synthesis-worker.ts` | extraction cycle + backfill cursor |
| `mcp-server/src/index.ts` | `recall` tool; fact rendering in `brief_me` / `context_for` / `search` |
| `package.json` | `graph:backfill`, `graph:eval` scripts |
