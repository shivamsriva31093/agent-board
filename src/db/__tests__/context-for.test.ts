import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/embeddings", () => ({
  embedText: vi.fn().mockResolvedValue(new Float32Array(384).fill(0.1)),
  cosineSimilarity: vi.fn().mockReturnValue(0.85),
  EMBEDDING_DIM: 384,
}));

import { createTestDb } from "@/db/connection";
import { createService } from "@/db/service";
import { createQueries, type Queries } from "@/db/queries";

// The pre-edit hook sends absolute paths and no intent; agents mostly post
// scopes relative to wherever they were running.
const HOOK_FILE = "/Users/someone/codes/mono/agent-board/hooks/pre-edit-context.sh";

describe("contextFor scope matching", () => {
  let svc: ReturnType<typeof createService>;
  let q: Queries;

  beforeEach(() => {
    const db = createTestDb();
    svc = createService(db);
    q = createQueries(db);
  });

  async function post(project: string, text: string, scope?: string[]) {
    const { entry_id } = await svc.postInsight({
      agentId: `${project}/main-abc`,
      project,
      text,
      scope,
    });
    return entry_id;
  }

  it("finds entries whose relative scope names an absolute file path", async () => {
    const hit = await post("agent-board", "Fixed the hook reading file_path.", [
      "agent-board/hooks/pre-edit-context.sh",
    ]);
    await post("other", "Restyled the layout header.", ["app/layout.tsx"]);
    await post("other", "General musing with no scope at all.");

    const result = await svc.contextFor({
      files: [HOOK_FILE],
      intent: "",
      project: "agent-board",
    });

    expect(result.entries.map((e) => e.id)).toEqual([hit]);
  });

  it("finds entries scoped to an ancestor directory", async () => {
    const hit = await post("agent-board", "All hooks must exit 0.", ["agent-board/hooks/"]);

    const result = await svc.contextFor({ files: [HOOK_FILE], intent: "", project: "agent-board" });

    expect(result.entries.map((e) => e.id)).toEqual([hit]);
  });

  it("only counts single-segment scope matches within the caller's project", async () => {
    const mine = await post("alpha", "README install steps are out of date.", ["README.md"]);
    await post("beta", "Rewrote the beta README.", ["README.md"]);

    const result = await svc.contextFor({
      files: ["/work/alpha/README.md"],
      intent: "",
      project: "alpha",
    });

    expect(result.entries.map((e) => e.id)).toEqual([mine]);
  });

  it("resolves the caller's project from a registered repo path", async () => {
    q.upsertProject({
      id: "acme-app",
      display_name: "Acme App",
      description: null,
      aliases: [],
      repo_paths: ["acme-app", "acme-backend"],
    });
    const mine = await post("acme-app", "Backend README needs env docs.", ["README.md"]);

    const result = await svc.contextFor({
      files: ["/work/acme-backend/README.md"],
      intent: "",
      project: "acme-backend",
    });

    expect(result.entries.map((e) => e.id)).toEqual([mine]);
  });

  it("returns claims whose relative scope matches an absolute file path", async () => {
    svc.createClaim("agent-board/other-def", "agent-board", "agent-board/hooks/pre-edit-context.sh", "file", 60);

    const result = await svc.contextFor({ files: [HOOK_FILE], intent: "", project: "agent-board" });

    expect(result.claims.map((c) => c.agent_id)).toEqual(["agent-board/other-def"]);
  });

  it("does not create a project for an unknown caller project", async () => {
    await svc.contextFor({ files: [HOOK_FILE], intent: "", project: "never-seen" });

    expect(q.getProject("never-seen")).toBeFalsy();
  });
});
