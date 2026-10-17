import { describe, it, expect } from "vitest";
import { scopeMatchDepth, relevantMatchDepth } from "@/lib/scope-match";

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

describe("relevantMatchDepth", () => {
  const other = (ownerRepoNames: string[], callerRepoNames: string[] = []) => ({ sameProject: false, ownerRepoNames, callerRepoNames });

  it("counts any match within the caller's own project", () => {
    expect(relevantMatchDepth("README.md", "/w/app/README.md", { sameProject: true, ownerRepoNames: ["app"], callerRepoNames: ["app"] })).toBe(1);
    expect(relevantMatchDepth("src/db", "src/db/queries.ts", { sameProject: true, ownerRepoNames: ["app"], callerRepoNames: ["app"] })).toBe(2);
  });

  it("ignores another project's generic path when the file isn't inside that project", () => {
    const file = "/Users/dev/code/agent-board-oss/src/db/__tests__/x.test.ts";
    expect(relevantMatchDepth("src/db", file, other(["brandkit-api"]))).toBe(0);
    expect(relevantMatchDepth("src/db/queries.ts", "src/db/queries.ts", other(["brandkit-api"]))).toBe(0);
  });

  it("counts another project's scope when the file sits inside that project's directory", () => {
    const file = "/Users/dev/code/monorepo/agent-board/hooks/x.sh";
    expect(relevantMatchDepth("hooks/x.sh", file, other(["agent-board"]))).toBe(2);
    expect(relevantMatchDepth("agent-board/hooks/x.sh", file, other(["monorepo"]))).toBe(3);
  });

  it("accepts any of the project's registered repo directory names", () => {
    expect(relevantMatchDepth("src/a.ts", "/w/acme-backend/src/a.ts", other(["acme-app", "acme-backend"]))).toBe(2);
  });

  it("requires the project directory at or before the match, not after it", () => {
    expect(relevantMatchDepth("src/util", "/w/app/src/util/beta/f.ts", other(["beta"]))).toBe(0);
  });

  it("counts another project's scope that spells out the file's absolute path", () => {
    const file = "/Users/dev/code/monorepo/agent-board/src/db/service.ts";
    expect(relevantMatchDepth(file, file, other(["monorepo"]))).toBe(8);
  });

  it("counts another project's scope for a relative file when the scope names the caller's directory just before it", () => {
    expect(relevantMatchDepth("agent-board/hooks/x.sh", "hooks/x.sh", other(["monorepo"], ["agent-board"]))).toBe(2);
    expect(relevantMatchDepth("acme-api/hooks/x.sh", "hooks/x.sh", other(["monorepo"], ["agent-board"]))).toBe(0);
  });
});
