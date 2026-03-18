import { describe, it, expect } from "vitest";
import { parseQuery } from "@/lib/intent";

describe("parseQuery", () => {
  // ID detection
  it("detects #id pattern", () => {
    const r = parseQuery("#1030");
    expect(r.intent).toBe("id");
    expect(r.id).toBe(1030);
  });

  it("detects bare number", () => {
    const r = parseQuery("1030");
    expect(r.intent).toBe("id");
    expect(r.id).toBe(1030);
  });

  // Question detection
  it("detects question ending with ?", () => {
    const r = parseQuery("what is the greenlet bug?");
    expect(r.intent).toBe("question");
    expect(r.query_clean).toBe("what is the greenlet bug?");
  });

  it("detects question word at start", () => {
    const r = parseQuery("how does the auth middleware work");
    expect(r.intent).toBe("question");
  });

  it("detects 'show me' prefix", () => {
    const r = parseQuery("show me bugfixes from today");
    expect(r.intent).toBe("question");
  });

  it("detects 'tell me' prefix", () => {
    const r = parseQuery("tell me about connection pool issues");
    expect(r.intent).toBe("question");
  });

  // Filter extraction
  it("extracts project filter", () => {
    const r = parseQuery("project:acme-app pool exhaustion");
    expect(r.filters.project).toBe("acme-app");
    expect(r.query_clean).toBe("pool exhaustion");
    expect(r.intent).toBe("search");
  });

  it("extracts type filter", () => {
    const r = parseQuery("type:bugfix greenlet");
    expect(r.filters.type).toBe("bugfix");
    expect(r.query_clean).toBe("greenlet");
  });

  it("extracts by (agent) filter", () => {
    const r = parseQuery("by:acme-app/main-8de7f6 webhook");
    expect(r.filters.agent).toBe("acme-app/main-8de7f6");
    expect(r.query_clean).toBe("webhook");
  });

  it("extracts since filter", () => {
    const r = parseQuery("since:today connection pool");
    expect(r.filters.since).toBe("today");
    expect(r.query_clean).toBe("connection pool");
  });

  it("extracts multiple filters", () => {
    const r = parseQuery("project:acme-app type:bugfix pool");
    expect(r.filters.project).toBe("acme-app");
    expect(r.filters.type).toBe("bugfix");
    expect(r.query_clean).toBe("pool");
  });

  // Plain search
  it("treats plain keywords as search", () => {
    const r = parseQuery("greenlet async bug");
    expect(r.intent).toBe("search");
    expect(r.query_clean).toBe("greenlet async bug");
    expect(r.filters).toEqual({});
  });

  // Edge: filters inside question
  it("extracts filters from question query", () => {
    const r = parseQuery("what bugs are in project:acme-app?");
    expect(r.intent).toBe("question");
    expect(r.filters.project).toBe("acme-app");
    expect(r.query_clean).toBe("what bugs are in?");
  });
});
