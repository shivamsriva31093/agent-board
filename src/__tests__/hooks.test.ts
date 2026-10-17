import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";

describe("retired hooks", () => {
  it("session-end.sh still exits 0 silently for installs that predate its removal", () => {
    const r = spawnSync("bash", ["hooks/session-end.sh"], { input: '{"session_id":"abc","hook_event_name":"SessionEnd"}' });
    expect({ status: r.status, stdout: r.stdout.toString(), stderr: r.stderr.toString() }).toEqual({ status: 0, stdout: "", stderr: "" });
  });
});
