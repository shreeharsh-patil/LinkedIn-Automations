// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";

import { checkSafety, DEFAULT_SAFETY_CONFIG } from "./safety-checker.js";

function makeSafeParams() {
  return {
    score: 8,
    unsupportedClaimCount: 0,
    slopScore: 10,
    slopPassed: true,
    contentHash: "abc123",
    existingContentHashes: new Set<string>(),
    visualGenerationFailed: false,
    candidateConfidence: 0.8,
    linkedinAuthHealthy: true,
  };
}

describe("checkSafety", () => {
  it("returns safe when all checks pass", () => {
    const result = checkSafety(makeSafeParams());
    expect(result.safe).toBe(true);
    expect(result.failures).toHaveLength(0);
    expect(result.summary).toContain("passed");
  });

  it("fails when score is below threshold", () => {
    const params = makeSafeParams();
    params.score = 2;
    const result = checkSafety(params);
    expect(result.safe).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.check).toBe("score_threshold");
    expect(result.failures[0]?.severity).toBe("hard");
  });

  it("fails when unsupported claims remain", () => {
    const params = makeSafeParams();
    params.unsupportedClaimCount = 3;
    const result = checkSafety(params);
    expect(result.safe).toBe(false);
    expect(result.failures[0]?.check).toBe("unsupported_claims");
    expect(result.failures[0]?.severity).toBe("hard");
  });

  it("fails when SlopGuard fails", () => {
    const params = makeSafeParams();
    params.slopPassed = false;
    const result = checkSafety(params);
    expect(result.safe).toBe(false);
    expect(result.failures[0]?.check).toBe("slop_guard");
  });

  it("fails when slop score is too high", () => {
    const params = makeSafeParams();
    params.slopScore = 50;
    const result = checkSafety(params);
    expect(result.safe).toBe(false);
    expect(result.failures[0]?.check).toBe("slop_guard");
  });

  it("fails when content hash is duplicate", () => {
    const params = makeSafeParams();
    params.existingContentHashes = new Set(["abc123"]);
    const result = checkSafety(params);
    expect(result.safe).toBe(false);
    expect(result.failures[0]?.check).toBe("duplicate_suspected");
  });

  it("fails when visual generation failed and mandatory", () => {
    const params = makeSafeParams();
    params.visualGenerationFailed = true;
    const result = checkSafety(params, { visualMandatory: true });
    expect(result.safe).toBe(false);
    expect(result.failures[0]?.check).toBe("visual_generation_failed");
  });

  it("passes when visual generation failed but not mandatory", () => {
    const params = makeSafeParams();
    params.visualGenerationFailed = true;
    const result = checkSafety(params, { visualMandatory: false });
    expect(result.safe).toBe(true);
  });

  it("fails when LinkedIn auth is unhealthy", () => {
    const params = makeSafeParams();
    params.linkedinAuthHealthy = false;
    const result = checkSafety(params);
    expect(result.safe).toBe(false);
    expect(result.failures[0]?.check).toBe("linkedin_auth_unhealthy");
  });

  it("fails (soft) when candidate confidence is low", () => {
    const params = makeSafeParams();
    params.candidateConfidence = 0.2;
    const result = checkSafety(params);
    // Soft failure doesn't make it unsafe
    expect(result.safe).toBe(true);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.severity).toBe("soft");
  });

  it("collects multiple failures", () => {
    const params = makeSafeParams();
    params.score = 1;
    params.unsupportedClaimCount = 2;
    params.slopPassed = false;
    params.linkedinAuthHealthy = false;
    const result = checkSafety(params);
    expect(result.safe).toBe(false);
    expect(result.failures.length).toBeGreaterThanOrEqual(4);
  });

  it("uses default config when not provided", () => {
    const result = checkSafety(makeSafeParams());
    expect(result.safe).toBe(true);
    expect(DEFAULT_SAFETY_CONFIG.scoreThreshold).toBe(5);
  });

  it("respects custom config", () => {
    const params = makeSafeParams();
    params.score = 6;
    // Default threshold is 5, so 6 passes
    const result1 = checkSafety(params);
    expect(result1.safe).toBe(true);

    // Custom threshold of 10, so 6 fails
    const result2 = checkSafety(params, { scoreThreshold: 10 });
    expect(result2.safe).toBe(false);
  });
});
