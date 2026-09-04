// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";
import { ContentValidator } from "./content-validator.js";

describe("ContentValidator", () => {
  it("rejects empty or short text", () => {
    const empty = ContentValidator.validate("   ");
    expect(empty.valid).toBe(false);
    expect(empty.errors).toContain("Post content cannot be empty.");

    const tooShort = ContentValidator.validate("Hello world, this is a short update.");
    expect(tooShort.valid).toBe(false);
    expect(tooShort.errors[0]).toContain("Post is too short");
  });

  it("rejects text exceeding 3000 characters", () => {
    const hugeText = "Word ".repeat(650); // ~3250 chars
    const result = ContentValidator.validate(hugeText);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("3000"))).toBe(true);
  });

  it("detects placeholder strings", () => {
    const postWithPlaceholder =
      "We just implemented a new caching layer for our database. You can read the documentation here: [Insert Link Here]. Benchmarks show 40% latency reduction across the board.";
    const result = ContentValidator.validate(postWithPlaceholder);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("placeholder"))).toBe(true);
  });

  it("detects unclosed code fences / backticks", () => {
    const brokenCode =
      "We just migrated our caching layer to use `redis for all session storage. This improved our p99 query latency by 45ms across all regions.";
    const result = ContentValidator.validate(brokenCode);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("unclosed backtick"))).toBe(true);
  });

  it("detects AI buzzwords and slop", () => {
    const slopPost =
      "I am thrilled to announce that our team built a revolutionary tool! In today's rapidly evolving world, this game-changer is unlocking the power of AI.";
    const result = ContentValidator.validate(slopPost);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("AI slop"))).toBe(true);
  });

  it("warns about duplicate hashtags and flags excessive hashtags", () => {
    const post =
      "Migrated our Postgres indexing strategy. Added partial B-tree indices on created_at and status columns. p95 query latency dropped from 140ms down to 12ms.\n\n#postgres #database #sql #backend #indexing #postgresql #postgres";
    const result = ContentValidator.validate(post);
    expect(result.warnings.some((w) => w.includes("Duplicate hashtags") || w.includes("Too many hashtags"))).toBe(true);
    expect(result.errors.some((e) => e.includes("excessive-hashtags") || e.includes("AI slop"))).toBe(true);
  });

  it("validates high-quality technical post and generates strong quality score", () => {
    const highQuality = `We reduced SQLite write transaction latency by 72% (from 45ms to 12.5ms) in our Node.js automation pipeline.

Here is what was causing the bottleneck:
1. Every write was executing inside its own standalone synchronous SQLite statement, triggering disk sync on every single iteration.
2. By wrapping batch updates in an explicit \`BEGIN IMMEDIATE\` transaction block and enabling WAL mode (\`PRAGMA journal_mode=WAL\`), disk fsyncs dropped from 500/sec to 1 per batch.

Takeaway: Always verify your database journaling mode and wrap bulk operations in immediate transactions when running high-frequency worker processes.

#typescript #sqlite #backend`;

    const result = ContentValidator.validate(highQuality);
    expect(result.valid).toBe(true);
    expect(result.canPublish).toBe(true);
    expect(result.metrics.technicalValue).toBeGreaterThanOrEqual(75);
    expect(result.metrics.specificity).toBeGreaterThanOrEqual(70);
    expect(result.metrics.overallScore).toBeGreaterThanOrEqual(70);
  });
});
