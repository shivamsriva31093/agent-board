import { describe, it, expect } from "vitest";
import { extractSummary, classifyEntryType } from "../text-processing";

describe("extractSummary", () => {
  it("extracts first sentence", () => {
    const text = "Fixed a race condition in browser-worker. Two jobs were sharing a page.";
    expect(extractSummary(text)).toBe("Fixed a race condition in browser-worker.");
  });

  it("handles text without period — returns full text", () => {
    const text = "investigating the auth middleware for potential issues with token refresh";
    expect(extractSummary(text)).toBe(text);
  });

  it("strips markdown bold/italic", () => {
    const text = "**Fixed** a _critical_ bug in the **worker pool**. It was bad.";
    expect(extractSummary(text)).toBe("Fixed a critical bug in the worker pool.");
  });

  it("truncates very long first sentences", () => {
    const long = "A".repeat(200) + ". Short.";
    const summary = extractSummary(long);
    expect(summary.length).toBeLessThanOrEqual(160);
    expect(summary.endsWith("...")).toBe(true);
  });
});

describe("classifyEntryType", () => {
  it("detects bugfix", () => {
    expect(classifyEntryType("fixed a race condition in the pool")).toBe("bugfix");
    expect(classifyEntryType("bug in the auth middleware")).toBe("bugfix");
  });

  it("detects decision", () => {
    expect(classifyEntryType("decided to use PostgreSQL instead of MySQL")).toBe("decision");
    expect(classifyEntryType("went with approach B for the cache layer")).toBe("decision");
  });

  it("detects shipped", () => {
    expect(classifyEntryType("shipped the new dashboard feature")).toBe("shipped");
    expect(classifyEntryType("deployed v2.1 to production")).toBe("shipped");
  });

  it("detects struggle", () => {
    expect(classifyEntryType("struggling with the webpack config")).toBe("struggle");
    expect(classifyEntryType("stuck on a weird TypeScript error")).toBe("struggle");
  });

  it("detects question", () => {
    expect(classifyEntryType("how do we handle auth tokens?")).toBe("question");
    expect(classifyEntryType("anyone know why the tests are flaky?")).toBe("question");
  });

  it("detects pattern", () => {
    expect(classifyEntryType("found a good pattern for error boundaries")).toBe("pattern");
  });

  it("detects warning", () => {
    expect(classifyEntryType("careful with the SQLite busy timeout setting")).toBe("warning");
    expect(classifyEntryType("gotcha: arrays are truthy in JS even when empty")).toBe("warning");
  });

  it("defaults to discovery", () => {
    expect(classifyEntryType("explored the codebase and mapped the architecture")).toBe("discovery");
  });
});
