import { describe, it, expect } from "vitest";
import { scopeMatchDepth } from "@/lib/scope-match";

describe("scopeMatchDepth", () => {
  const abs = "/Users/someone/codes/mono/agent-board/hooks/pre-edit-context.sh";

  it("matches a relative scope against an absolute file path", () => {
    expect(scopeMatchDepth("hooks/pre-edit-context.sh", abs)).toBe(2);
    expect(scopeMatchDepth("agent-board/hooks/pre-edit-context.sh", abs)).toBe(3);
  });

  it("matches a scope naming an ancestor directory of the file", () => {
    expect(scopeMatchDepth("agent-board/hooks/", abs)).toBe(2);
    expect(scopeMatchDepth("./src/db/", "src/db/queries.ts")).toBe(2);
  });

  it("matches when the caller passes a directory containing the scope", () => {
    expect(scopeMatchDepth("src/db/service.ts", "src/db")).toBe(2);
  });

  it("matches identical paths, absolute or relative", () => {
    expect(scopeMatchDepth(abs, abs)).toBe(7);
    expect(scopeMatchDepth("src/db/queries.ts", "src/db/queries.ts")).toBe(3);
  });

  it("reports single-segment matches as depth 1", () => {
    expect(scopeMatchDepth("README.md", "/a/b/README.md")).toBe(1);
  });

  it("only matches whole path segments", () => {
    expect(scopeMatchDepth("hooks/pre-edit.sh", abs)).toBe(0);
    expect(scopeMatchDepth("db/service.ts", "/a/src/db/service.tsx")).toBe(0);
    expect(scopeMatchDepth("src", "/a/srcx/file.ts")).toBe(0);
  });

  it("returns 0 for empty input", () => {
    expect(scopeMatchDepth("", abs)).toBe(0);
    expect(scopeMatchDepth("src/", "")).toBe(0);
  });
});
