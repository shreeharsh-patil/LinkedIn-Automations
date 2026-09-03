// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";

import { detectSlop } from "./slop-guard.js";

describe("detectSlop", () => {
  it("passes clean technical text", () => {
    const result = detectSlop(
      "Migrated our API from Express to Fastify. Benchmarks show 2x improvement in request throughput under concurrent load.",
    );
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.score).toBe(0);
  });

  it("detects 'excited to share'", () => {
    const result = detectSlop("Excited to share our new feature launch");
    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.phrase.toLowerCase()).toContain("excited to share");
    expect(result.violations[0]?.severity).toBe("critical");
  });

  it("detects 'game changer'", () => {
    const result = detectSlop("This update is a game changer for our team");
    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.category).toBe("corporate-jargon");
  });

  it("detects 'thrilled to announce'", () => {
    const result = detectSlop("Thrilled to announce our new release");
    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.phrase.toLowerCase().includes("thrilled to announce"))).toBe(true);
  });

  it("detects 'revolutionary'", () => {
    const result = detectSlop("A revolutionary approach to database indexing");
    expect(result.passed).toBe(false);
  });

  it("detects 'unlocking the power'", () => {
    const result = detectSlop("Unlocking the power of async patterns in Node.js");
    expect(result.passed).toBe(false);
  });

  it("detects 'delve into'", () => {
    const result = detectSlop("Let's delve into the implementation details");
    expect(result.passed).toBe(false);
  });

  it("detects 'seamlessly'", () => {
    const result = detectSlop("This integrates seamlessly with existing systems");
    expect(result.passed).toBe(false);
  });

  it("detects 'this isn't just X, it's Y'", () => {
    const result = detectSlop("This isn't just a library, it's a paradigm shift");
    expect(result.passed).toBe(false);
  });

  it("detects engagement bait 'thoughts?'", () => {
    const result = detectSlop("New feature deployed\nThoughts?");
    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.category === "engagement-bait")).toBe(true);
  });

  it("detects excessive hashtags", () => {
    const result = detectSlop("Testing #ai #tech #dev #code #engineering #startup");
    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.category === "excessive-hashtags")).toBe(true);
  });

  it("warns on 'leverage'", () => {
    const result = detectSlop("We leverage Redis for caching");
    expect(result.passed).toBe(true); // Warning only
    expect(result.violations.some((v) => v.phrase === "leverage")).toBe(true);
    expect(result.violations.some((v) => v.severity === "warning")).toBe(true);
  });

  it("warns on 'cutting-edge'", () => {
    const result = detectSlop("Using cutting-edge technology for the backend");
    expect(result.passed).toBe(true);
    expect(result.violations.some((v) => v.category === "corporate-jargon")).toBe(true);
  });

  it("detects multiple violations", () => {
    const result = detectSlop(
      "Excited to share this game-changing revolutionary approach that seamlessly transforms the landscape",
    );
    expect(result.passed).toBe(false);
    expect(result.violations.length).toBeGreaterThanOrEqual(3);
    expect(result.score).toBeGreaterThan(50);
  });

  it("returns score 0 for clean text", () => {
    const result = detectSlop(
      "Fixed a race condition in the connection pool. The issue was that connections were being returned before the transaction committed.",
    );
    expect(result.score).toBe(0);
  });

  it("returns summary with violation count", () => {
    const result = detectSlop("Excited to share");
    expect(result.summary).toContain("1 critical");
  });

  it("returns clean summary when no violations", () => {
    const result = detectSlop("Simple technical post about TypeScript generics");
    expect(result.summary).toContain("No AI slop detected");
  });
});
