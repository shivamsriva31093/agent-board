import { describe, it, expect } from "vitest";
import { scoreSignal } from "@/lib/signal";

describe("scoreSignal", () => {
  it.each([
    ["Shipped Task 4 in agent-board — added mentions to briefMe.", 0.3],
    ["WIP on the dashboard", 0.3],
    ["Fixed a race in the worker pool: two jobs shared one page because the pool wasn't awaiting lock release.", 1.0],
    ["Decided to use cursor pagination instead of offset for the feed; offset got slow past fifty thousand rows.", 1.0],
    ["Shipped the retry queue. We chose exponential backoff because the upstream rate-limits bursts of requests.", 0.6],
    ["Added the AnalyticsCharts client component with four Recharts charts.", 0.5],
  ])("scores %j as %d", (text, expected) => {
    expect(scoreSignal({ text })).toBeCloseTo(expected, 5);
  });

  it("gives a code block +0.1 but never goes below the 0.3 floor", () => {
    expect(scoreSignal({ text: "WIP on the dashboard", hasCode: true })).toBeCloseTo(0.3, 5);
    expect(scoreSignal({ text: "Added the AnalyticsCharts client component with four Recharts charts.", hasCode: true })).toBeCloseTo(0.6, 5);
  });

  it("returns exact values on the 0.1 grid, without float noise", () => {
    expect(scoreSignal({ text: "Added the AnalyticsCharts client component with four Recharts charts." })).toBe(0.5);
  });

  it("matches the task-done pattern anywhere in the text", () => {
    expect(scoreSignal({ text: "Agent-board: task 7 is done now, moving on to the next part of the plan today." })).toBeCloseTo(0.3, 5);
  });
});
