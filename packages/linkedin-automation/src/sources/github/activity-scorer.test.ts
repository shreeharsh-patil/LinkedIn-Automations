// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";

import { scoreActivity, scoreRelease } from "./activity-scorer.js";
import type { CommitAnalysis } from "../github/commit-analyzer.js";
import type { GitHubRelease } from "../github/github-client.js";

function makeAnalysis(type: string, files: string[] = [], linesChanged = 50): CommitAnalysis {
  return {
    commit: {
      sha: "abc123",
      message: "test commit",
      author: "test",
      date: new Date().toISOString(),
      files: [],
    },
    type: type as CommitAnalysis["type"],
    summary: "test",
    keyFiles: files,
    linesChanged,
    meaningful: true,
  };
}

function makeRelease(tag: string, prerelease = false): GitHubRelease {
  return {
    tagName: tag,
    name: "",
    body: "",
    prerelease,
    createdAt: new Date().toISOString(),
  };
}

describe("scoreActivity", () => {
  it("scores feature commits positively", () => {
    const result = scoreActivity([makeAnalysis("feature")]);
    expect(result.score).toBeGreaterThan(0);
    expect(result.factors.length).toBeGreaterThan(0);
  });

  it("scores bugfix commits positively", () => {
    const result = scoreActivity([makeAnalysis("bugfix")]);
    expect(result.score).toBeGreaterThan(0);
  });

  it("scores performance commits positively", () => {
    const result = scoreActivity([makeAnalysis("performance")]);
    expect(result.score).toBeGreaterThan(0);
  });

  it("scores security commits positively", () => {
    const result = scoreActivity([makeAnalysis("security")]);
    expect(result.score).toBeGreaterThan(0);
  });

  it("scores architecture commits positively", () => {
    const result = scoreActivity([makeAnalysis("architecture")]);
    expect(result.score).toBeGreaterThan(0);
  });

  it("scores dependency updates negatively", () => {
    const result = scoreActivity([makeAnalysis("deps")]);
    expect(result.score).toBeLessThan(0);
  });

  it("scores doc-only changes negatively", () => {
    const result = scoreActivity([makeAnalysis("docs")]);
    expect(result.score).toBeLessThan(0);
  });

  it("scores style-only changes negatively", () => {
    const result = scoreActivity([makeAnalysis("style")]);
    expect(result.score).toBeLessThan(0);
  });

  it("adds bonus for package.json changes", () => {
    const result = scoreActivity([makeAnalysis("feature", ["package.json"])]);
    expect(result.score).toBeGreaterThan(5);
  });

  it("adds bonus for large changes", () => {
    const result = scoreActivity([makeAnalysis("feature", [], 200)]);
    expect(result.score).toBeGreaterThan(5);
  });

  it("combines multiple commits", () => {
    const result = scoreActivity([makeAnalysis("feature"), makeAnalysis("bugfix"), makeAnalysis("performance")]);
    expect(result.score).toBeGreaterThan(10);
  });

  it("qualifies when score meets threshold", () => {
    const result = scoreActivity([makeAnalysis("feature"), makeAnalysis("bugfix")]);
    expect(result.qualifies).toBe(true);
  });

  it("does not qualify when score is low", () => {
    const result = scoreActivity([makeAnalysis("style")]);
    expect(result.qualifies).toBe(false);
  });
});

describe("scoreRelease", () => {
  it("scores releases positively", () => {
    const result = scoreRelease(makeRelease("v1.0.0"));
    expect(result.score).toBeGreaterThanOrEqual(5);
    expect(result.qualifies).toBe(true);
  });

  it("penalizes pre-releases", () => {
    const result = scoreRelease(makeRelease("v1.0.0-beta.1", true));
    expect(result.score).toBeLessThan(5);
  });

  it("adds bonus for initial major release", () => {
    const result = scoreRelease(makeRelease("v1.0.0"));
    expect(result.score).toBeGreaterThan(5);
  });
});
