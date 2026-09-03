// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Poll-based scheduler for automated LinkedIn posting.
 *
 * Uses a polling interval (default: 60 seconds) to check for due posts.
 * No long-running setTimeout chains — each poll cycle is independent.
 *
 * Flow:
 *   1. Poll for due scheduled posts
 *   2. Acquire publish lock
 *   3. Mark PROCESSING
 *   4. Publish via LinkedCtlPublisher
 *   5. Save LinkedIn Post ID
 *   6. Mark PUBLISHED
 *
 * On failure:
 *   - Classify the error
 *   - Retry with bounded exponential backoff (only for retryable failures)
 *   - Mark FAILED after exhausting retries
 */

import type { StoragePort } from "../storage/storage.js";
import type { ScheduledPostRecord } from "../storage/types.js";
import { IdempotentPublisher } from "../storage/idempotent-publisher.js";
import { classifyFailure } from "./failure-classifier.js";
import { calculateRetry, sleep, type RetryConfig, DEFAULT_RETRY_CONFIG } from "./retry.js";

/**
 * Scheduler options.
 */
export interface SchedulerOptions {
  /** Polling interval in milliseconds (default: 60000 = 1 minute). */
  pollIntervalMs?: number;
  /** Retry configuration. */
  retryConfig?: Partial<RetryConfig>;
  /** Abort signal for graceful shutdown. */
  signal?: AbortSignal;
  /** Callback invoked after each publish attempt. */
  onPublish?: (result: PublishAttemptResult) => void;
}

/**
 * Result of a single publish attempt.
 */
export interface PublishAttemptResult {
  /** The scheduled post that was attempted. */
  scheduledPost: ScheduledPostRecord;
  /** Whether the publish succeeded. */
  success: boolean;
  /** Whether this was a no-op (already published). */
  alreadyPublished: boolean;
  /** Error message if failed. */
  error: string | undefined;
  /** Failure category if failed. */
  failureCategory: string | undefined;
  /** Number of attempts made. */
  attempts: number;
}

/**
 * Worker statistics.
 */
export interface WorkerStats {
  /** Total poll cycles completed. */
  pollCycles: number;
  /** Total posts attempted. */
  postsAttempted: number;
  /** Total posts published successfully. */
  postsPublished: number;
  /** Total posts that failed. */
  postsFailed: number;
  /** Total posts skipped (already published). */
  postsSkipped: number;
  /** When the worker started. */
  startedAt: string | undefined;
}

/**
 * The main scheduler class.
 *
 * Polls the storage for due scheduled posts and publishes them
 * with retry logic and failure classification.
 */
export class Scheduler {
  private readonly storage: StoragePort;
  private readonly publisher: IdempotentPublisher;
  private readonly pollIntervalMs: number;
  private readonly retryConfig: RetryConfig;
  private readonly onPublish: ((result: PublishAttemptResult) => void) | undefined;

  private abortController: AbortController | undefined;
  private polling = false;
  private stats: WorkerStats = {
    pollCycles: 0,
    postsAttempted: 0,
    postsPublished: 0,
    postsFailed: 0,
    postsSkipped: 0,
    startedAt: undefined,
  };

  constructor(storage: StoragePort, publisher: IdempotentPublisher, options?: SchedulerOptions) {
    this.storage = storage;
    this.publisher = publisher;
    this.pollIntervalMs = options?.pollIntervalMs ?? 60_000;
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...options?.retryConfig };
    this.onPublish = options?.onPublish;
  }

  /**
   * Get current worker statistics.
   */
  getStats(): WorkerStats {
    return { ...this.stats };
  }

  /**
   * Check if the worker is currently polling.
   */
  isRunning(): boolean {
    return this.polling;
  }

  /**
   * Start the polling loop.
   *
   * This runs until the abort signal is triggered or stop() is called.
   * Each poll cycle is independent — no long-running timers.
   */
  async start(options?: SchedulerOptions): Promise<void> {
    if (this.polling) {
      return;
    }

    this.polling = true;
    this.stats = {
      pollCycles: 0,
      postsAttempted: 0,
      postsPublished: 0,
      postsFailed: 0,
      postsSkipped: 0,
      startedAt: new Date().toISOString(),
    };

    // Use provided signal or create our own
    this.abortController = new AbortController();
    const signal = options?.signal ?? this.abortController.signal;

    // Add abort listener from external signal
    if (options?.signal !== undefined) {
      options.signal.addEventListener(
        "abort",
        () => {
          this.abortController?.abort();
        },
        { once: true },
      );
    }

    try {
      while (!signal.aborted) {
        await this.pollCycle();
        this.stats.pollCycles++;

        // Sleep for the poll interval (interruptible)
        try {
          await sleep(this.pollIntervalMs, signal);
        } catch {
          // AbortError — exit cleanly
          break;
        }
      }
    } finally {
      this.polling = false;
    }
  }

  /**
   * Stop the polling loop gracefully.
   */
  stop(): void {
    this.abortController?.abort();
  }

  /**
   * Run a single poll cycle.
   *
   * Checks for due posts and attempts to publish each one.
   */
  async pollCycle(): Promise<PublishAttemptResult[]> {
    const results: PublishAttemptResult[] = [];

    // Always check for due posts regardless of schedule day/time
    // The schedule config is used for creating new schedules, not for filtering
    // existing scheduled posts that are already past their time
    let duePost = this.storage.getNextScheduledPost();
    while (duePost !== undefined) {
      const result = await this.processScheduledPost(duePost);
      results.push(result);

      if (this.onPublish !== undefined) {
        this.onPublish(result);
      }

      // Get next due post
      duePost = this.storage.getNextScheduledPost();
    }

    return results;
  }

  /**
   * Process a single scheduled post with retry logic.
   */
  private async processScheduledPost(scheduled: ScheduledPostRecord): Promise<PublishAttemptResult> {
    this.stats.postsAttempted++;

    let lastError: string | undefined;
    let lastCategory: string | undefined;
    let attempts = 0;

    // Retry loop
    for (;;) {
      attempts++;

      // Re-fetch the scheduled post (it may have changed)
      const current = this.storage.getScheduledPost(scheduled.id);
      if (current === undefined) {
        // Removed
        this.stats.postsSkipped++;
        return {
          scheduledPost: scheduled,
          success: true,
          alreadyPublished: true,
          error: undefined,
          failureCategory: undefined,
          attempts,
        };
      }

      // If state is not SCHEDULED, check if it was already processed
      if (current.state !== "SCHEDULED") {
        if (current.state === "PUBLISHED") {
          this.stats.postsSkipped++;
          return {
            scheduledPost: current,
            success: true,
            alreadyPublished: true,
            error: undefined,
            failureCategory: undefined,
            attempts,
          };
        }
        // State is FAILED or PROCESSING — we need to reset to SCHEDULED for retry
        // (IdempotentPublisher marks FAILED on failure, so we reset it)
        if (current.state === "FAILED") {
          this.storage.updateScheduledPostState(current.id, "SCHEDULED");
          current.state = "SCHEDULED";
        } else {
          // PROCESSING or other unexpected state — skip
          this.stats.postsSkipped++;
          return {
            scheduledPost: current,
            success: false,
            alreadyPublished: false,
            error: `Unexpected state: ${current.state}`,
            failureCategory: undefined,
            attempts,
          };
        }
      }

      // Attempt to publish
      const result = await this.publisher.publishScheduledPost(current);

      if (result.success) {
        this.stats.postsPublished++;
        // Re-fetch to get updated state
        const updated = this.storage.getScheduledPost(current.id) ?? current;
        return {
          scheduledPost: updated,
          success: true,
          alreadyPublished: result.alreadyPublished,
          error: undefined,
          failureCategory: undefined,
          attempts,
        };
      }

      // Classify the failure
      const failure = classifyFailure(result.error);
      lastError = result.error;
      lastCategory = failure.category;

      // Check if we should retry
      const decision = calculateRetry(attempts - 1, failure, this.retryConfig);

      if (!decision.shouldRetry) {
        // Exhausted retries or non-retryable
        this.stats.postsFailed++;
        return {
          scheduledPost: current,
          success: false,
          alreadyPublished: false,
          error: lastError,
          failureCategory: lastCategory,
          attempts,
        };
      }

      // Wait before retrying
      try {
        await sleep(decision.delayMs, this.abortController?.signal);
      } catch {
        // AbortError — stop retrying
        this.stats.postsFailed++;
        return {
          scheduledPost: current,
          success: false,
          alreadyPublished: false,
          error: "Worker stopped during retry backoff",
          failureCategory: lastCategory,
          attempts,
        };
      }
    }
  }
}
