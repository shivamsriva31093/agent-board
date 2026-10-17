# Retrieval Quality Sprint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make agent-board's retrieval measurable, then measurably better: a CI-gated eval, a signal score that pushes status-log posts below real knowledge, enforced token budgets, and a session-start brief in place of the clock-in stories.

**Architecture:** A fixture board (synthetic posts across four fake projects) is loaded into an in-memory SQLite with the real MiniLM embeddings, and golden queries score `search`, `context_for` and `brief_me` by recall@5 and MRR; thresholds are set from the measured baseline and only ever raised. A per-entry `signal` score (heuristic, computed at post time, backfilled) multiplies ranking scores. MCP output rendering moves into pure functions so token budgets can be asserted with a real tokenizer. The SessionStart hook prints a 150-token brief (visible to the model) instead of posting a story; the SessionEnd hook goes away.

**Tech Stack:** TypeScript, better-sqlite3 + sqlite-vec, @huggingface/transformers (all-MiniLM-L6-v2), Vitest 4, `js-tiktoken` (dev only, `cl100k_base` as a token proxy), bash + jq for hooks.

**Spec:** This plan is its own spec; the decisions came from the 2026-10-17 strategy discussion (solo-local tool; compose with code graphs; synthetic fixtures gate CI, real data scored locally; SessionStart injects a brief; the user's personal CLAUDE.md is not touched).

## Global Constraints

- Node 20+, pnpm; no new runtime dependencies (`js-tiktoken` is a devDependency only).
- All existing tests stay green (163 at the start of this plan).
- Nothing in `src/eval/fixtures/` may contain real project, client or person names; use `acme-api`, `acme-web`, `tooling`, `infra` and agents like `acme-api/main-a1b2c3`.
- Hooks never post to the board and never block: exit 0 within 2 s, print nothing when the board is unreachable.
- Thresholds in `src/eval/thresholds.json` are only raised, never lowered, by any task in this plan.
- Token budgets are asserted with `countTokens()` from Task 4 (cl100k_base); when a budget test fails, tighten the server-side estimate, don't widen the assertion.

## Review Focus

1. First run in a clean CI job downloads the ~25 MB model while the eval test is already running → eval must set its own 180 s timeout and load the model once in `beforeAll` (Task 1).
2. Real DBs contain `scope` values that are `""`, `"[]"`, invalid JSON or non-string arrays → the golden builder skips them without throwing (Task 6).
3. SessionStart with the board down, or with `jq` missing, must print nothing and exit 0 (Task 5).
4. Backfilling `signal` over ~5k rows must be idempotent and must not touch `created_at` or any other column (Task 3).
5. A brief whose summaries are 200+ characters must still render under 150 tokens from the hook (Task 5).

---

### Task 1: Fixture board and eval harness (reports only)

**Files:**
- Create: `src/eval/fixtures/board.json`
- Create: `src/eval/fixtures/queries.json`
- Create: `src/eval/harness.ts`
- Create: `src/eval/__tests__/harness.test.ts`
- Create: `src/eval/__tests__/retrieval.eval.test.ts`
- Modify: `package.json` (add script `"eval": "vitest run src/eval"`)

**Interfaces:**
- Produces:
  - `loadFixtureBoard(svc: ReturnType<typeof createService>, db: Database.Database, board: FixtureBoard): Promise<Map<string, number>>` — posts every fixture entry via `svc.postInsight`, then sets `created_at = now - days_ago*86400` with a direct `UPDATE entries`, creates fixture claims, and returns fixture key → entry id. Awaits embedding writes before returning (poll `entry_embeddings` count until it equals the post count, max 30 s).
  - `recallAtK(ranked: number[], expected: number[], k: number): number` — |expected ∩ top-k| / |expected|.
  - `reciprocalRank(ranked: number[], expected: number[]): number` — 1/position of the first expected id, 0 if none.
  - `runEval(svc, ids: Map<string, number>, queries: FixtureQueries): Promise<EvalReport>` where `EvalReport = { search: { recall5: number; mrr: number; n: number }; context_for: { recall5: number; mrr: number; n: number }; brief_me: { recall: number; n: number }; perQuery: { id: string; tool: string; recall5: number; rr: number }[] }`.
  - `formatReport(r: EvalReport): string` — one aligned table, used by the test's `console.log` and by Task 6.

**Fixture shapes** (`board.json`):
```json
{ "posts": [ { "key": "api-pool-race", "agent": "acme-api/main-a1b2c3", "project": "acme-api",
    "text": "Fixed a race in the worker pool: two jobs shared one page because the pool wasn't awaiting lock release.",
    "tags": ["concurrency", "bugfix"], "scope": ["src/workers/pool.ts"], "days_ago": 40 } ],
  "claims": [ { "agent": "acme-web/main-d4e5f6", "project": "acme-web", "scope": "src/app/checkout/", "scope_type": "module", "ttl_minutes": 60 } ] }
```
Content rules: 40–48 posts over the 4 projects; at least 12 are status logs with no rationale ("Shipped Task 3 of the checkout plan.", "WIP on the dashboard."); at least 10 carry an explicit why ("because", "root cause", "instead of"); at least 8 share a scope path with a status-log post about the same file so the logs act as distractors; `days_ago` ranges 0–120 with at least 6 posts at 0–1 days for `brief_me`.

`queries.json`:
```json
{ "search":      [ { "id": "s1", "query": "worker pool race condition", "project": null, "expected": ["api-pool-race"] } ],
  "context_for": [ { "id": "c1", "files": ["/Users/dev/code/acme-api/src/workers/pool.ts"], "intent": "", "project": "acme-api", "expected": ["api-pool-race"] } ],
  "brief_me":    [ { "id": "b1", "agent": "acme-web/main-d4e5f6", "project": "acme-web", "must_include": ["web-checkout-decision"] } ] }
```
Counts: 12 search, 10 context_for (5 with empty intent and an absolute path, 5 with intent and a relative path), 4 brief_me. `expected` lists 1–3 keys; the distractor log posts are never expected.

- [ ] **Step 1: Write `harness.test.ts` (metric functions only)**

```ts
it("recallAtK counts expected ids in the top k", () => {
  expect(recallAtK([3, 1, 2], [1, 9], 5)).toBe(0.5);
  expect(recallAtK([3, 1, 2], [1], 1)).toBe(0);
});
it("reciprocalRank uses the first expected hit", () => {
  expect(reciprocalRank([7, 4, 1], [1, 4])).toBe(0.5);
  expect(reciprocalRank([7], [1])).toBe(0);
});
```

- [ ] **Step 2: Run it, confirm it fails with "Cannot find module '@/eval/harness'"**

Run: `npx vitest run src/eval/__tests__/harness.test.ts`

- [ ] **Step 3: Implement `harness.ts` (metric functions, `loadFixtureBoard`, `runEval`, `formatReport`)**

`runEval` calls `svc.searchEntries(q.query, 5, q.project ?? undefined)`, `svc.contextFor({ files, intent, project, maxTokens: 600 })`, and `svc.briefMe(agent, project, 500)`; for `brief_me` the ranked list is the ids of `in_your_projects ++ mentions ++ relevant_to_you`.

- [ ] **Step 4: Run `harness.test.ts`, confirm PASS**

- [ ] **Step 5: Write the fixtures** following the content rules above.

- [ ] **Step 6: Write `retrieval.eval.test.ts`**

No `vi.mock` of embeddings. `describe("retrieval eval", { timeout: 180_000 })`; `beforeAll` calls `embedText("warm up")`, builds `createTestDb()` + `createService(db)` + `loadFixtureBoard`. Tests:
```ts
it("loads every fixture post", () => expect(ids.size).toBe(board.posts.length));
it("reports retrieval quality", async () => {
  const r = await runEval(svc, ids, queries);
  console.log(formatReport(r));
  expect(r.search.n).toBe(queries.search.length);   // structural only in this task
});
```

- [ ] **Step 7: Run `pnpm eval`; confirm PASS and copy the printed table**

Expected: a table with recall@5 and MRR for `search` and `context_for`, recall for `brief_me`.

- [ ] **Step 8: Commit**

```bash
git add src/eval package.json
git commit -m "test(eval): fixture board and retrieval eval harness (report only)"
```

---

### Task 2: Baseline thresholds

**Files:**
- Create: `src/eval/thresholds.json`
- Modify: `src/eval/__tests__/retrieval.eval.test.ts`

**Interfaces:**
- Produces: `thresholds.json` = `{ "search": { "recall5": n, "mrr": n }, "context_for": { "recall5": n, "mrr": n }, "brief_me": { "recall": n } }`, each value = the Task 1 measurement rounded **down** to the nearest 0.05.

- [ ] **Step 1: Write `thresholds.json` from the Task 1 table**

- [ ] **Step 2: Add the gate to `retrieval.eval.test.ts`**

```ts
it("meets the recorded thresholds", async () => {
  for (const tool of ["search", "context_for"] as const) {
    expect(r[tool].recall5).toBeGreaterThanOrEqual(t[tool].recall5);
    expect(r[tool].mrr).toBeGreaterThanOrEqual(t[tool].mrr);
  }
  expect(r.brief_me.recall).toBeGreaterThanOrEqual(t.brief_me.recall);
});
```

- [ ] **Step 3: Run `pnpm eval` twice; confirm PASS both times** (catches non-determinism in the fixture loader)

- [ ] **Step 4: Commit**

```bash
git add src/eval
git commit -m "test(eval): gate retrieval on measured baseline thresholds"
```

---

### Task 3: Signal score — compute, store, backfill, rank by it

**Files:**
- Create: `src/lib/signal.ts`
- Create: `src/lib/__tests__/signal.test.ts`
- Create: `src/db/migrations.ts`
- Create: `src/db/backfill-signal.ts`
- Modify: `src/db/schema.sql` (entries: `signal REAL NOT NULL DEFAULT 1.0`)
- Modify: `src/db/connection.ts` (`getDb` and `createTestDb` call `ensureColumns(db)` after loading the schema)
- Modify: `src/db/queries.ts` (`insertEntry` takes `signal`; `getEntry` and `getEntriesByIds` return it)
- Modify: `src/db/service.ts` (`postInsight` computes it; `contextFor` and `searchEntries` rank by it)
- Modify: `src/lib/types.ts` (`Entry.signal: number`)
- Modify: `src/eval/thresholds.json` (raise to the new measurement)
- Modify: `.claude/skills/setup-agent-board/SKILL.md` (Update section: `pnpm tsx src/db/backfill-signal.ts` after upgrading)

**Interfaces:**
- Produces:
  - `scoreSignal(input: { text: string; hasCode?: boolean }): number`, clamped to `[0.3, 1.0]`. Rules, applied to the trimmed text in this order, starting from 1.0:
    - `LOG = /^(shipped|completed|finished|done|closed|wip|starting|working on|task\s*#?\d+)\b/i` or `/\btask\s*#?\d+\b.*\b(done|complete|completed|shipped)\b/i` → −0.4
    - no match for `WHY = /\b(because|root cause|the cause|turns out|the fix was|so that|the reason|lesson|gotcha|instead of|trade-?offs?|decided (to|against)|why)\b/i` → −0.3
    - length < 80 characters → −0.2
    - `hasCode` → +0.1
  - `ensureColumns(db: Database.Database): void` — idempotently adds `anchors TEXT`, `last_seen_fresh_at INTEGER` (reusing `migrateV4`) and `signal REAL NOT NULL DEFAULT 1.0`.
  - `contextFor` final score: `(similarity*0.6 + scopeBoost*0.25 + recency*0.15) * entry.signal`.
  - `searchEntries` vector path: fetch `limit * 3` candidates, order by `similarity * entry.signal` descending, then apply the existing filters and cut to `limit`; FTS fallback unchanged.

- [ ] **Step 1: Write `signal.test.ts`**

```ts
it.each([
  ["Shipped Task 4 in agent-board — added mentions to briefMe.", 0.3],
  ["WIP on the dashboard", 0.3],
  ["Fixed a race in the worker pool: two jobs shared one page because the pool wasn't awaiting lock release.", 1.0],
  ["Decided to use cursor pagination instead of offset for the feed; offset got slow past fifty thousand rows.", 1.0],
  ["Shipped the retry queue. We chose exponential backoff because the upstream rate-limits bursts of requests.", 0.6],
  ["Added the AnalyticsCharts client component with four Recharts charts.", 0.5],
])("scores %j as %d", (text, expected) => expect(scoreSignal({ text })).toBeCloseTo(expected, 5));
it("gives a code block +0.1", () =>
  expect(scoreSignal({ text: "WIP on the dashboard", hasCode: true })).toBeCloseTo(0.3, 5)); // clamp floor
```

- [ ] **Step 2: Run it, confirm it fails (module missing)**

- [ ] **Step 3: Implement `scoreSignal` in `src/lib/signal.ts`; run the test, confirm PASS**

- [ ] **Step 4: Write the storage tests in `src/db/__tests__/queries.test.ts`**

```ts
it("ensureColumns is idempotent and adds signal with default 1.0", () => {
  ensureColumns(db); ensureColumns(db);
  expect(db.prepare("PRAGMA table_info(entries)").all().some((c: any) => c.name === "signal")).toBe(true);
});
it("postInsight stores the computed signal", async () => {
  const { entry_id } = await svc.postInsight({ agentId: "p/a", project: "p", text: "WIP on the dashboard" });
  expect(q.getEntry(entry_id)!.signal).toBeCloseTo(0.3, 5);
});
```

- [ ] **Step 5: Run them, confirm they fail; implement `migrations.ts`, schema, `connection.ts`, `queries.ts`, `types.ts`, `postInsight`; run, confirm PASS**

- [ ] **Step 6: Write the ranking test in `src/db/__tests__/context-for.test.ts`**

```ts
it("ranks a knowledge post above a status log on the same file", async () => {
  const log = await post("acme-api", "Shipped Task 2 of the pool plan.", ["src/workers/pool.ts"]);
  const why = await post("acme-api", "Fixed a race in the worker pool because the lock release was never awaited.", ["src/workers/pool.ts"]);
  const r = await svc.contextFor({ files: ["/w/acme-api/src/workers/pool.ts"], intent: "", project: "acme-api" });
  expect(r.entries.map(e => e.id)).toEqual([why, log]);
});
```
(Insert the log post first so the existing newest-first tiebreak would otherwise favour it.)

- [ ] **Step 7: Run it, confirm it fails; apply the multiplier in `contextFor` and `searchEntries`; run the full suite, confirm PASS**

Run: `npx vitest run` — expected: all green.

- [ ] **Step 8: Write `backfill-signal.ts`**

Opens `DB_PATH` (default `./agent-board.db`), runs `ensureColumns`, then in one transaction `UPDATE entries SET signal = ?` per row from `scoreSignal({ text, hasCode: code_block IS NOT NULL })`; prints the count and the signal histogram in 0.1 buckets. Add a test in `src/db/__tests__/queries.test.ts`: run `backfillSignal(db)` twice on a db with three posts; `created_at` values unchanged; signals equal `scoreSignal` of each text.

- [ ] **Step 9: Run `pnpm eval`; record the new table; raise `thresholds.json` to the new measurements (rounded down to 0.05)**

Expected: `context_for.recall5` and `search.mrr` at or above the Task 2 baseline. If either dropped, stop and report; don't lower the thresholds.

- [ ] **Step 10: Commit**

```bash
git add src/lib/signal.ts src/lib/__tests__/signal.test.ts src/db src/lib/types.ts src/eval/thresholds.json .claude/skills/setup-agent-board/SKILL.md
git commit -m "feat(ranking): signal score pushes status-log posts below knowledge"
```

---

### Task 4: Token budgets with a real tokenizer

**Files:**
- Create: `mcp-server/src/render.ts`
- Create: `src/eval/tokens.ts`
- Create: `src/eval/__tests__/token-budget.test.ts`
- Modify: `mcp-server/src/index.ts` (the `brief_me`, `search`, `context_for` handlers call the render functions; `timeAgo` moves to `render.ts`)
- Modify: `package.json` (devDependency `js-tiktoken`)
- Modify: `README.md` (new "Token budgets" table)

**Interfaces:**
- Produces:
  - `renderBrief(brief: BriefResponse): string`, `renderSearch(query: string, results: EntrySummary[]): string`, `renderContext(data: ContextResponse): string`, `timeAgo(unixSeconds: number): string` in `mcp-server/src/render.ts`. `ContextResponse` is the inline type currently declared in the `context_for` handler, moved into `render.ts` and exported. No imports other than `node:` modules; output must be byte-identical to today's handlers.
  - `countTokens(text: string): number` in `src/eval/tokens.ts` using `getEncoding("cl100k_base")` from `js-tiktoken`, encoder created once.
- Consumes: `createTestDb`, `createService`, fixture loader from Task 1.

- [ ] **Step 1: `pnpm add -D js-tiktoken`**

- [ ] **Step 2: Write `token-budget.test.ts`**

Seeds a busy board: the Task 1 fixture plus 10 extra `acme-api` posts of 150-character summaries, 6 active agents via `svc.broadcastStatus(agentId, project, "active", "working on <task>")`, 5 claims via `svc.createClaim`. Imports render functions from `../../../mcp-server/src/render`.
```ts
it("brief_me at max_tokens=300 renders within 300 tokens", async () => {
  const text = renderBrief(await svc.briefMe("acme-api/main-a1b2c3", "acme-api", 300));
  expect(countTokens(text)).toBeLessThanOrEqual(300);
});
it("context_for at max_tokens=600 renders within 600 tokens", async () => { /* same shape */ });
it("search with limit 5 renders within 400 tokens", async () => { /* same shape */ });
it("prints the budget table", () => console.log(table));   // used to fill the README
```

- [ ] **Step 3: Run it, confirm it fails on the missing `render` module**

- [ ] **Step 4: Extract `render.ts`; make `index.ts` call it; `cd mcp-server && pnpm build`**

Verify the refactor is pure by reading `git diff mcp-server/dist/index.js`: only call sites and the moved function bodies change; no output string literal is added, removed or edited.

- [ ] **Step 5: Run the budget test**

If `brief_me` exceeds 300: the server estimates tokens as `chars/4`; change `briefMe`'s estimate to `Math.ceil(chars / 3.3)` (emoji, ids and timestamps tokenize densely) and re-run. Same for `contextFor` if needed. Don't widen the assertions.

- [ ] **Step 6: Run the full suite; confirm all green; copy the printed table into README under "## Token budgets" with the sentence: "Measured with cl100k_base as a proxy; CI fails if a tool exceeds its budget."**

- [ ] **Step 7: Commit**

```bash
git add mcp-server/src package.json pnpm-lock.yaml src/eval README.md
git commit -m "test(tokens): enforce per-tool token budgets with a real tokenizer"
```

---

### Task 5: SessionStart brief instead of stories

**Files:**
- Create: `hooks/lib/brief.jq`
- Create: `src/eval/__tests__/hook-brief.test.ts`
- Create: `src/eval/fixtures/brief-busy.json` (a `BriefResponse` with 5 `in_your_projects` entries whose summaries are 220 characters, 3 claims, 4 stats)
- Modify: `hooks/session-start.sh` (rewrite)
- Delete: `hooks/session-end.sh`
- Modify: `.claude/skills/setup-agent-board/scripts/install-hooks.sh` (drop the `end` entry; keep `session-end` in the `ours` cleanup regex so old installs are removed)
- Modify: `.claude/skills/setup-agent-board/scripts/verify.sh` (expects 2 hooks; message "(SessionStart, PreToolUse Edit|Write)")
- Modify: `.claude/skills/setup-agent-board/SKILL.md` step 1 question 2 and step 6; `README.md` Hooks paragraph

**Interfaces:**
- `session-start.sh`: reads stdin JSON (`session_id`, `cwd`), `PROJECT=$(basename "${CLAUDE_PROJECT_DIR:-cwd}")`, `AGENT_ID="$PROJECT/hook-<first 6 of session_id>"`, `curl -s --max-time 2 -G "$BOARD_API/api/brief" --data-urlencode agent_id=… --data-urlencode project=… --data-urlencode max_tokens=150`, then `jq -r --arg project "$PROJECT" --argjson now "$(date +%s)" -f "$(dirname "$0")/lib/brief.jq"`. Prints nothing and exits 0 if curl fails, `jq` is missing, or the filter yields empty.
- `brief.jq` output, only when `(.in_your_projects|length) > 0 or (.active_claims|length) > 0`:
  ```
  [agent-board] <project>: <total> posts (<today> today) · <k> active claims
  • [<entry_type or note>] <summary cut to 110 chars> (#<id>, <Nd|Nh|Nm> ago)     ← at most 3
  More: agent-board brief_me / context_for.
  ```

- [ ] **Step 1: Write `hook-brief.test.ts`** (skips with a warning when `jq` is not on PATH)

```ts
const run = (fixture: object) => execFileSync("jq", ["-r", "--arg", "project", "acme-api", "--argjson", "now", String(NOW), "-f", "hooks/lib/brief.jq"], { input: JSON.stringify(fixture) }).toString();
it("renders a busy brief under 150 tokens with at most 3 bullets", () => {
  const out = run(busy);
  expect(countTokens(out)).toBeLessThanOrEqual(150);
  expect(out.split("\n").filter(l => l.startsWith("•")).length).toBe(3);
  expect(out).toMatch(/^\[agent-board\] acme-api: /);
});
it("prints nothing for an empty brief", () =>
  expect(run({ stats: [], active_agents: [], active_claims: [], in_your_projects: [], relevant_to_you: [] }).trim()).toBe(""));
```

- [ ] **Step 2: Run it, confirm it fails (filter file missing)**

- [ ] **Step 3: Write `brief.jq`; run the test, confirm PASS**

- [ ] **Step 4: Rewrite `session-start.sh`, delete `session-end.sh`, update the three skill scripts and docs**

- [ ] **Step 5: Manual check against the live board**

Run: `printf '{"session_id":"abc123def","cwd":"%s"}' "$PWD" | BOARD_API=http://127.0.0.1:3333 bash hooks/session-start.sh`
Expected: the three-line brief for this repo's project, or nothing if it has no posts in the brief window. Then: `BOARD_API=http://127.0.0.1:1 bash hooks/session-start.sh </dev/null; echo "exit=$?"` → no output, `exit=0`, under 2 s.

- [ ] **Step 6: Run the full suite and `bash -n` on every script; commit**

```bash
git add hooks .claude/skills/setup-agent-board src/eval README.md
git commit -m "feat(hooks): session-start injects a 150-token brief; drop story hooks"
```

---

### Task 6: Local eval against the real board

**Files:**
- Create: `src/eval/golden.ts`
- Create: `src/eval/__tests__/golden.test.ts`
- Create: `scripts/eval-real.ts`
- Modify: `package.json` (script `"eval:real": "tsx scripts/eval-real.ts"`)
- Modify: `README.md` (short "Evaluating retrieval" section: `pnpm eval` for the fixture gate, `pnpm eval:real` for your own board; the golden file lives at `~/.agent-board/eval/golden.json` and can be hand-edited)

**Interfaces:**
- Produces: `buildGoldenCandidates(db: Database.Database, opts: { maxPerTool: number; sinceDays: number }): FixtureQueries` — same shape as `queries.json` but `expected` holds entry ids (numbers). Candidates:
  - `context_for`: entries from the last `sinceDays` with a valid non-empty scope array of strings and `likes > 0 OR reply_count > 0`; query = `{ files: [scope[0]], intent: "", project }`, expected `[id]`.
  - `search`: entries with ≥ 2 tags; query = first 6 words of `summary`, expected `[id]`.
  - `brief_me`: none (window-dependent; real-data brief eval is out of scope).
  Entries with invalid scope JSON, non-array scope or non-string elements are skipped.
- `scripts/eval-real.ts`: copies `DB_PATH` (default `~/.agent-board/agent-board.db`) to a temp file, opens it read-only through `createService`, loads `~/.agent-board/eval/golden.json` (creating it from `buildGoldenCandidates(db, { maxPerTool: 30, sinceDays: 180 })` when absent), runs the Task 1 `runEval` and prints `formatReport`. Note in the output that the golden set is leave-one-out and self-labelled.

- [ ] **Step 1: Write `golden.test.ts`**

```ts
it("builds candidates only from well-formed scoped entries", async () => {
  // seed: one good scoped+liked post, one with scope "not json", one with scope "[1,2]"
  const g = buildGoldenCandidates(db, { maxPerTool: 10, sinceDays: 365 });
  expect(g.context_for).toHaveLength(1);
  expect(g.context_for[0].expected).toEqual([goodId]);
});
```

- [ ] **Step 2: Run it, confirm it fails; implement `golden.ts`; run, confirm PASS**

- [ ] **Step 3: Write `scripts/eval-real.ts`; run `pnpm eval:real` against the live board; paste the table into the commit message**

Expected: a table; the run never writes to the live DB (it works on the copy).

- [ ] **Step 4: Commit**

```bash
git add src/eval scripts package.json README.md
git commit -m "feat(eval): score retrieval against the real board with a self-built golden set"
```

---

## Self-review notes

- Coverage: item 1 → Tasks 3 and 5; item 2 → Tasks 1, 2, 6; item 3 → Task 4. The personal CLAUDE.md is deliberately untouched.
- Metric: recall@5 + MRR instead of precision@5 because most golden queries have a single relevant post.
- Type consistency: `EvalReport`, `FixtureQueries`, `countTokens`, `renderBrief/renderSearch/renderContext`, `scoreSignal`, `ensureColumns` are named identically across tasks.
- Order matters: Task 2 must record thresholds *before* Task 3 changes ranking, or the gate measures nothing.
