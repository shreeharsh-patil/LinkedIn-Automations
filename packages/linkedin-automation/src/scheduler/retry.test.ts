// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";

import { calculateRetry, DEFAULT_RETRY_CONFIG } from "./retry.js";
import type { ClassifiedFailure } from "./failure-classifier.js";

function makeRetryableFailure(): ClassifiedFailure {
  return { category: "NETWORK_ERROR", retryable: true, message: "timeout" };
}

function makeNonRetryableFailure(): ClassifiedFailure {
  return { category: "AUTH_ERROR", retryable: false, message: "auth failed" };
}

describe("calculateRetry", () => {
  it("retries retryable failures", () => {
    const decision = calculateRetry(0, makeRetryableFailure());
    expect(decision.shouldRetry).toBe(true);
    expect(decision.attempt).toBe(0);
    expect(decision.maxAttempts).toBe(DEFAULT_RETRY_CONFIG.maxRetries + 1);
    expect(decision.delayMs).toBeGreaterThan(0);
  });

  it("does not retry non-retryable failures", () => {
    const decision = calculateRetry(0, makeNonRetryableFailure());
    expect(decision.shouldRetry).toBe(false);
    expect(decision.delayMs).toBe(0);
  });

  it("stops after max retries", () => {
    const decision = calculateRetry(DEFAULT_RETRY_CONFIG.maxRetries, makeRetryableFailure());
    expect(decision.shouldRetry).toBe(false);
    expect(decision.attempt).toBe(DEFAULT_RETRY_CONFIG.maxRetries);
  });

  it("uses exponential backoff", () => {
    const config = { maxRetries: 5, baseDelayMs: 1000, maxDelayMs: 60_000, jitterFactor: 0 };

    const d0 = calculateRetry(0, makeRetryableFailure(), config);
    const d1 = calculateRetry(1, makeRetryableFailure(), config);
    const d2 = calculateRetry(2, makeRetryableFailure(), config);

    // Without jitter: 1000, 2000, 4000
    expect(d0.delayMs).toBe(1000);
    expect(d1.delayMs).toBe(2000);
    expect(d2.delayMs).toBe(4000);
  });

  it("caps delay at maxDelay", () => {
    const config = { maxRetries: 10, baseDelayMs: 1000, maxDelayMs: 5000, jitterFactor: 0 };

    const d5 = calculateRetry(5, makeRetryableFailure(), config);
    // 1000 * 2^5 = 32000, capped at 5000
    expect(d5.delayMs).toBe(5000);
  });

  it("adds jitter", () => {
    const config = { maxRetries: 5, baseDelayMs: 1000, maxDelayMs: 60_000, jitterFactor: 0.5 };

    // Run multiple times and check variance
    const delays = new Set<number>();
    for (let i = 0; i < 20; i++) {
      const d = calculateRetry(0, makeRetryableFailure(), config);
      delays.add(d.delayMs);
    }

    // With 50% jitter on 1000ms base, delays should vary
    expect(delays.size).toBeGreaterThan(1);
  });

  it("respects custom config", () => {
    const config = { maxRetries: 1, baseDelayMs: 100, maxDelayMs: 1000, jitterFactor: 0 };

    const d0 = calculateRetry(0, makeRetryableFailure(), config);
    expect(d0.shouldRetry).toBe(true);
    expect(d0.delayMs).toBe(100);
    expect(d0.maxAttempts).toBe(2);

    const d1 = calculateRetry(1, makeRetryableFailure(), config);
    expect(d1.shouldRetry).toBe(false);
  });
});
