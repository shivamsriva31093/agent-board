import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "@/db/connection";
import { buildGoldenCandidates } from "@/eval/golden";

const DAY = 86400;
const now = Math.floor(Date.now() / 1000);

describe("buildGoldenCandidates", () => {
  let db: Database.Database;
  const insert = (o: { text?: string; summary?: string; scope?: string | null; tags?: string | null; likes?: number; daysAgo?: number }) =>
    Number(
      db
        .prepare("INSERT INTO entries (agent_id, text, summary, scope, tags, likes, created_at) VALUES ('p/a', ?, ?, ?, ?, ?, ?)")
        .run(o.text ?? "text", o.summary ?? "summary", o.scope ?? null, o.tags ?? null, o.likes ?? 0, now - (o.daysAgo ?? 1) * DAY)
        .lastInsertRowid,
    );

  beforeEach(() => {
    db = createTestDb();
    db.prepare("INSERT INTO agents (id, project, avatar_seed, first_seen, last_seen) VALUES ('p/a', 'p', 'x', 1, 1)").run();
  });

  it("builds context_for candidates only from well-formed, engaged, scoped entries", () => {
    const good = insert({ scope: '["src/a.ts","src/b.ts"]', likes: 1 });
    insert({ scope: "not json", likes: 1 });
    insert({ scope: "[1,2]", likes: 1 });
    insert({ scope: "[]", likes: 1 });
    insert({ scope: '["src/c.ts"]', likes: 0 });

    const g = buildGoldenCandidates(db, { maxPerTool: 10, sinceDays: 365 });

    expect(g.context_for).toHaveLength(1);
    expect(g.context_for[0]).toMatchObject({ files: ["src/a.ts"], intent: "", project: "p", expected: [good] });
  });

  it("counts a reply as engagement", () => {
    const replied = insert({ scope: '["src/a.ts"]' });
    db.prepare("INSERT INTO replies (post_id, agent_id, text, created_at) VALUES (?, 'p/a', 'agreed', ?)").run(replied, now);
    expect(buildGoldenCandidates(db, { maxPerTool: 10, sinceDays: 365 }).context_for.map((q) => q.expected[0])).toEqual([replied]);
  });

  it("leaves out context_for entries older than sinceDays", () => {
    insert({ scope: '["src/a.ts"]', likes: 1, daysAgo: 200 });
    expect(buildGoldenCandidates(db, { maxPerTool: 10, sinceDays: 180 }).context_for).toHaveLength(0);
  });

  it("builds search candidates from entries with 2+ tags, querying the first 6 words of the summary", () => {
    const tagged = insert({ tags: '["a","b"]', summary: "one two three four five six seven eight" });
    insert({ tags: '["a"]', summary: "single tag entry" });
    insert({ tags: "oops", summary: "bad tags" });

    const g = buildGoldenCandidates(db, { maxPerTool: 10, sinceDays: 365 });

    expect(g.search).toEqual([{ id: `s${tagged}`, query: "one two three four five six", project: null, expected: [tagged] }]);
  });

  it("caps each tool at maxPerTool, newest first, and builds no brief_me queries", () => {
    const ids = [1, 2, 3].map((d) => insert({ scope: '["src/a.ts"]', likes: 1, daysAgo: d }));
    const g = buildGoldenCandidates(db, { maxPerTool: 2, sinceDays: 365 });
    expect(g.context_for.map((q) => q.expected[0])).toEqual([ids[0], ids[1]]);
    expect(g.brief_me).toEqual([]);
  });
});
