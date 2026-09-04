// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Poll-based scheduler for automated LinkedIn posting.
 *
 * Uses an atomic job claiming mechanism to ensure that multiple concurrent workers
 * never publish the same scheduled post.
 *
 * Flow:
 *   1. Atomically claim the next due scheduled post (claimNextScheduledPost)
 *   2. Lock duration and attempt counts are persisted in storage
 *   3. Publish via LinkedCtlPublisher (supporting text & image)
 *   4. Save LinkedIn Post ID/URN & mark PUBLISHED
 *
 * On failure:
 *   - Classify the error (rate-limit, transient 5xx, or permanent)
 *   - Persist attempt counter and last_error in SQLite
 *   - Retry with bounded exponential backoff only for retryable failures
 *   - Mark FAILED after exhausting retries
 */

import { randomUUID } from "node:crypto";
import type { StoragePort } from "../storage/storage.js";
import type { ScheduledPostRecord } from "../storage/types.js";
import { IdempotentPublisher } from "../storage/idempotent-publisher.js";
import { classifyFailure } from "./failure-classifier.js";
import { calculateRetry, sleep, type RetryConfig, DEFAULT_RETRY_CONFIG } from "./retry.js";

/** Default publish lock duration (5 minutes). */
const DEFAULT_LOCK_DURATION_MS = 5 * 60 * 1000;

/**
 * Scheduler options.
 */
export interface SchedulerOptions {
  /** Polling interval in milliseconds (default: 60000 = 1 minute). */
  pollIntervalMs?: number;
  /** Lock duration in milliseconds (default: 300000 = 5 minutes). */
  lockDurationMs?: number;
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
 */
export class Scheduler {
  private readonly storage: StoragePort;
  private readonly publisher: IdempotentPublisher;
  private readonly pollIntervalMs: number;
  private readonly lockDurationMs: number;
  private readonly retryConfig: RetryConfig;
  private readonly onPublish: ((result: PublishAttemptResult) => void) | undefined;
  private readonly workerId: string;

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
    this.lockDurationMs = options?.lockDurationMs ?? DEFAULT_LOCK_DURATION_MS;
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...options?.retryConfig };
    this.onPublish = options?.onPublish;
    this.workerId = `worker-${randomUUID().slice(0, 8)}`;
  }

  getStats(): WorkerStats {
    return { ...this.stats };
  }

  isRunning(): boolean {
    return this.polling;
  }

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

    this.abortController = new AbortController();
    const signal = options?.signal ?? this.abortController.signal;

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

        try {
          await sleep(this.pollIntervalMs, signal);
        } catch {
          break;
        }
      }
    } finally {
      this.polling = false;
    }
  }

  stop(): void {
    this.abortController?.abort();
  }

  /**
   * Run a single poll cycle with atomic job claiming.
   */
  async pollCycle(): Promise<PublishAttemptResult[]> {
    const results: PublishAttemptResult[] = [];
    const lockId = `${this.workerId}-${randomUUID()}`;

    // Atomically claim next due scheduled post (SELECT + lock in single step)
    let claimedPost = this.storage.claimNextScheduledPost(lockId, this.lockDurationMs);

    while (claimedPost !== undefined) {
      const result = await this.processClaimedPost(claimedPost, lockId);
      results.push(result);

      if (this.onPublish !== undefined) {
        this.onPublish(result);
      }

      // Check next due post
      claimedPost = this.storage.claimNextScheduledPost(lockId, this.lockDurationMs);
    }

    return results;
  }

  /**
   * Process an atomically claimed scheduled post with bounded retry logic.
   */
  private async processClaimedPost(scheduled: ScheduledPostRecord, lockId: string): Promise<PublishAttemptResult> {
    this.stats.postsAttempted++;

    let lastError: string | undefined;
    let lastCategory: string | undefined;
    let attempts = scheduled.attempts ?? 0;

    for (;;) {
      attempts++;
      this.storage.updateScheduledPostAttempt(scheduled.id, attempts, lastError);

      const draft = this.storage.getDraft(scheduled.draftId);
      if (draft === undefined) {
        this.stats.postsFailed++;
        this.storage.updateScheduledPostState(scheduled.id, "FAILED");
        this.storage.releasePublishLock(scheduled.id, lockId);
        return {
          scheduledPost: scheduled,
          success: false,
          alreadyPublished: false,
          error: `Draft #${scheduled.draftId} not found`,
          failureCategory: "VALIDATION_ERROR",
          attempts,
        };
      }

      const result = await this.publisher.publishDraft(draft);

      if (result.success) {
        this.stats.postsPublished++;
        this.storage.updateScheduledPostState(scheduled.id, "PUBLISHED");
        this.storage.releasePublishLock(scheduled.id, lockId);

        const updated = this.storage.getScheduledPost(scheduled.id) ?? scheduled;
        return {
          scheduledPost: updated,
          success: true,
          alreadyPublished: result.alreadyPublished,
          error: undefined,
          failureCategory: undefined,
          attempts,
        };
      }

      // Failure handling
      const failure = classifyFailure(result.error);
      lastError = result.error;
      lastCategory = failure.category;
      this.storage.updateScheduledPostAttempt(scheduled.id, attempts, lastError);

      // Check if we should retry
      const decision = calculateRetry(attempts - 1, failure, this.retryConfig);

      if (!decision.shouldRetry) {
        this.stats.postsFailed++;
        this.storage.updateScheduledPostState(scheduled.id, "FAILED");
        this.storage.releasePublishLock(scheduled.id, lockId);

        const updated = this.storage.getScheduledPost(scheduled.id) ?? scheduled;
        return {
          scheduledPost: updated,
          success: false,
          alreadyPublished: false,
          error: lastError,
          failureCategory: lastCategory,
          attempts,
        };
      }

      // Wait before next retry attempt
      try {
        await sleep(decision.delayMs, this.abortController?.signal);
      } catch {
        this.stats.postsFailed++;
        this.storage.updateScheduledPostState(scheduled.id, "FAILED");
        this.storage.releasePublishLock(scheduled.id, lockId);

        return {
          scheduledPost: scheduled,
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
