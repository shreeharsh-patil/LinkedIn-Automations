// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";

import { POST_STATES, VALID_TRANSITIONS, isValidTransition, DEFAULT_SETTINGS } from "./types.js";

describe("POST_STATES", () => {
  it("contains all expected states", () => {
    expect(POST_STATES).toContain("DISCOVERED");
    expect(POST_STATES).toContain("ANALYZING");
    expect(POST_STATES).toContain("DRAFT");
    expect(POST_STATES).toContain("REVIEW_REQUIRED");
    expect(POST_STATES).toContain("APPROVED");
    expect(POST_STATES).toContain("SCHEDULED");
    expect(POST_STATES).toContain("PROCESSING");
    expect(POST_STATES).toContain("PUBLISHED");
    expect(POST_STATES).toContain("FAILED");
    expect(POST_STATES).toContain("SKIPPED");
    expect(POST_STATES).toHaveLength(10);
  });

  it("has all states as valid PostState values", () => {
    for (const state of POST_STATES) {
      expect(typeof state).toBe("string");
    }
  });
});

describe("isValidTransition", () => {
  it("allows DISCOVERED → ANALYZING", () => {
    expect(isValidTransition("DISCOVERED", "ANALYZING")).toBe(true);
  });

  it("allows DISCOVERED → SKIPPED", () => {
    expect(isValidTransition("DISCOVERED", "SKIPPED")).toBe(true);
  });

  it("allows full happy path", () => {
    expect(isValidTransition("DISCOVERED", "ANALYZING")).toBe(true);
    expect(isValidTransition("ANALYZING", "DRAFT")).toBe(true);
    expect(isValidTransition("DRAFT", "REVIEW_REQUIRED")).toBe(true);
    expect(isValidTransition("REVIEW_REQUIRED", "APPROVED")).toBe(true);
    expect(isValidTransition("APPROVED", "SCHEDULED")).toBe(true);
    expect(isValidTransition("SCHEDULED", "PROCESSING")).toBe(true);
    expect(isValidTransition("PROCESSING", "PUBLISHED")).toBe(true);
  });

  it("allows failure from multiple states", () => {
    expect(isValidTransition("ANALYZING", "FAILED")).toBe(true);
    expect(isValidTransition("REVIEW_REQUIRED", "FAILED")).toBe(true);
    expect(isValidTransition("SCHEDULED", "FAILED")).toBe(true);
    expect(isValidTransition("PROCESSING", "FAILED")).toBe(true);
  });

  it("allows skip from multiple states", () => {
    expect(isValidTransition("DISCOVERED", "SKIPPED")).toBe(true);
    expect(isValidTransition("ANALYZING", "SKIPPED")).toBe(true);
    expect(isValidTransition("DRAFT", "SKIPPED")).toBe(true);
    expect(isValidTransition("REVIEW_REQUIRED", "SKIPPED")).toBe(true);
    expect(isValidTransition("APPROVED", "SKIPPED")).toBe(true);
  });

  it("rejects invalid transitions", () => {
    expect(isValidTransition("PUBLISHED", "DRAFT")).toBe(false);
    expect(isValidTransition("FAILED", "PUBLISHED")).toBe(false);
    expect(isValidTransition("SKIPPED", "DRAFT")).toBe(false);
    expect(isValidTransition("DRAFT", "PUBLISHED")).toBe(false);
    expect(isValidTransition("SCHEDULED", "ANALYZING")).toBe(false);
  });

  it("rejects self-transitions for terminal states", () => {
    expect(isValidTransition("PUBLISHED", "PUBLISHED")).toBe(false);
    expect(isValidTransition("FAILED", "FAILED")).toBe(false);
    expect(isValidTransition("SKIPPED", "SKIPPED")).toBe(false);
  });
});

describe("VALID_TRANSITIONS", () => {
  it("has entries for all states", () => {
    for (const state of POST_STATES) {
      expect(VALID_TRANSITIONS.has(state)).toBe(true);
    }
  });

  it("has terminal states pointing to empty arrays", () => {
    expect(VALID_TRANSITIONS.get("PUBLISHED")).toEqual([]);
    expect(VALID_TRANSITIONS.get("FAILED")).toEqual([]);
    expect(VALID_TRANSITIONS.get("SKIPPED")).toEqual([]);
  });
});

describe("DEFAULT_SETTINGS", () => {
  it("has sensible defaults", () => {
    expect(DEFAULT_SETTINGS.lookbackDays).toBe(7);
    expect(DEFAULT_SETTINGS.scoreThreshold).toBe(5);
    expect(DEFAULT_SETTINGS.maxWords).toBe(300);
    expect(DEFAULT_SETTINGS.includeHashtags).toBe(true);
    expect(DEFAULT_SETTINGS.minPostIntervalMs).toBeGreaterThan(0);
  });
});
