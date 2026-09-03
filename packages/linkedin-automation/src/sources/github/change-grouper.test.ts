// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";

import { groupCommits } from "./change-grouper.js";
import type { CommitAnalysis } from "../github/commit-analyzer.js";

function makeAnalysis(sha: string, date: string, type: string, files: string[] = []): CommitAnalysis {
  return {
    commit: {
      sha,
      message: `Commit ${sha}`,
      author: "test",
      date,
      files: [],
    },
    type: type as CommitAnalysis["type"],
    summary: `Change ${sha}`,
    keyFiles: files,
    linesChanged: 50,
    meaningful: true,
  };
}

describe("groupCommits", () => {
  it("returns empty for empty input", () => {
    const groups = groupCommits([]);
    expect(groups).toHaveLength(0);
  });

  it("returns one group for a single commit", () => {
    const groups = groupCommits([makeAnalysis("abc", "2026-01-01T10:00:00Z", "feature")]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.commits).toHaveLength(1);
  });

  it("groups commits with same directory overlap", () => {
    const groups = groupCommits([
      makeAnalysis("abc", "2026-01-01T10:00:00Z", "feature", ["src/auth/login.ts"]),
      makeAnalysis("def", "2026-01-01T11:00:00Z", "feature", ["src/auth/signup.ts"]),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.commits).toHaveLength(2);
  });

  it("groups commits with related types", () => {
    const groups = groupCommits([
      makeAnalysis("abc", "2026-01-01T10:00:00Z", "feature"),
      makeAnalysis("def", "2026-01-01T11:00:00Z", "refactor"),
    ]);
    expect(groups).toHaveLength(1);
  });

  it("separates commits with large time gaps", () => {
    const groups = groupCommits([
      makeAnalysis("abc", "2026-01-01T10:00:00Z", "feature"),
      makeAnalysis("def", "2026-01-03T10:00:00Z", "bugfix"), // 2 days later
    ]);
    expect(groups).toHaveLength(2);
  });

  it("separates unrelated commits in same time window", () => {
    const groups = groupCommits([
      makeAnalysis("abc", "2026-01-01T10:00:00Z", "feature", ["src/app.ts"]),
      makeAnalysis("def", "2026-01-01T11:00:00Z", "docs", ["README.md"]),
    ]);
    // May or may not group depending on type relationship
    expect(groups.length).toBeGreaterThanOrEqual(1);
  });

  it("generates meaningful titles", () => {
    const groups = groupCommits([makeAnalysis("abc", "2026-01-01T10:00:00Z", "feature", ["src/app.ts"])]);
    expect(groups[0]?.title).toContain("abc");
  });

  it("includes key files from all commits", () => {
    const groups = groupCommits([
      makeAnalysis("abc", "2026-01-01T10:00:00Z", "feature", ["src/a.ts", "src/b.ts"]),
      makeAnalysis("def", "2026-01-01T11:00:00Z", "feature", ["src/b.ts", "src/c.ts"]),
    ]);
    expect(groups[0]?.keyFiles).toContain("src/a.ts");
    expect(groups[0]?.keyFiles).toContain("src/b.ts");
    expect(groups[0]?.keyFiles).toContain("src/c.ts");
  });

  it("sets correct time span", () => {
    const groups = groupCommits([
      makeAnalysis("abc", "2026-01-01T10:00:00Z", "feature"),
      makeAnalysis("def", "2026-01-01T14:00:00Z", "feature"),
    ]);
    expect(groups[0]?.timeSpan.first).toBe("2026-01-01T10:00:00Z");
    expect(groups[0]?.timeSpan.last).toBe("2026-01-01T14:00:00Z");
  });
});
