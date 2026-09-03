// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Bounded exponential backoff for retryable failures.
 *
 * Retry strategy:
 * - Only retry failures classified as retryable
 * - Exponential backoff: baseDelay * 2^attempt
 * - Capped at maxDelay
 * - Stops after maxRetries attempts
 * - Adds jitter to prevent thundering herd
 */

import type { ClassifiedFailure } from "./failure-classifier.js";

/**
 * Retry configuration.
 */
export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3). */
  maxRetries: number;
  /** Base delay in milliseconds (default: 5000). */
  baseDelayMs: number;
  /** Maximum delay in milliseconds (default: 300000 = 5 minutes). */
  maxDelayMs: number;
  /** Jitter factor 0-1 (default: 0.25). */
  jitterFactor: number;
}

/**
 * Default retry configuration.
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 5_000,
  maxDelayMs: 300_000,
  jitterFactor: 0.25,
};

/**
 * Result of a retry decision.
 */
export interface RetryDecision {
  /** Whether to retry. */
  shouldRetry: boolean;
  /** Delay in milliseconds before the next attempt (0 if not retrying). */
  delayMs: number;
  /** The attempt number (0-indexed). */
  attempt: number;
  /** Maximum attempts. */
  maxAttempts: number;
}

/**
 * Calculate the next retry delay using bounded exponential backoff.
 *
 * @param attempt - Current attempt number (0-indexed).
 * @param failure - The classified failure from the last attempt.
 * @param config - Retry configuration.
 * @returns Retry decision with delay and whether to continue.
 */
export function calculateRetry(
  attempt: number,
  failure: ClassifiedFailure,
  config?: Partial<RetryConfig>,
): RetryDecision {
  const cfg: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };

  // Non-retryable failures — stop immediately
  if (!failure.retryable) {
    return { shouldRetry: false, delayMs: 0, attempt, maxAttempts: cfg.maxRetries + 1 };
  }

  // Exceeded max retries
  if (attempt >= cfg.maxRetries) {
    return { shouldRetry: false, delayMs: 0, attempt, maxAttempts: cfg.maxRetries + 1 };
  }

  // Exponential backoff: baseDelay * 2^attempt
  const exponentialDelay = cfg.baseDelayMs * Math.pow(2, attempt);

  // Cap at maxDelay
  const cappedDelay = Math.min(exponentialDelay, cfg.maxDelayMs);

  // Add jitter: delay * (1 +/- jitterFactor)
  const jitterRange = cappedDelay * cfg.jitterFactor;
  const jitter = (Math.random() * 2 - 1) * jitterRange;
  const delay = Math.round(cappedDelay + jitter);

  return {
    shouldRetry: true,
    delayMs: Math.max(0, delay),
    attempt,
    maxAttempts: cfg.maxRetries + 1,
  };
}

/**
 * Sleep for the specified number of milliseconds.
 *
 * Uses AbortController for clean cancellation.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const timer = setTimeout(resolve, ms);

    if (signal !== undefined) {
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      );
    }
  });
}
