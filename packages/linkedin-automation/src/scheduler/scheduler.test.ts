// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

import { SqliteStorage } from "../storage/sqlite-storage.js";
import { IdempotentPublisher } from "../storage/idempotent-publisher.js";
import { generateContentHash } from "../storage/content-hash.js";
import { Scheduler } from "./scheduler.js";
import type { PostDraftRecord, ScheduleConfig } from "../storage/types.js";

let storage: SqliteStorage;
let tempDir: string;

/** Mock publisher that returns configurable results. */
function createMockPublisher() {
  return {
    publishText: vi.fn().mockResolvedValue({
      success: true,
      postId: "12345",
      postUrn: "urn:li:share:12345",
      postUrl: "https://linkedin.com/posts/12345",
    }),
    publishImage: vi.fn().mockResolvedValue({ success: true }),
    getAccount: vi.fn().mockResolvedValue({ sub: "test", name: "Test" }),
  };
}

function makeDraft(candidateId: string, overrides?: Partial<PostDraftRecord>): Omit<PostDraftRecord, "id"> {
  return {
    candidateId,
    text: `Draft text for ${candidateId}`,
    wordCount: 10,
    factsUsed: ["fact-1"],
    slopScore: 5,
    verificationSummary: "1 supported",
    reviewDecision: "APPROVED",
    reviewScore: 85,
    suggestions: [],
    state: "APPROVED",
    contentHash: generateContentHash(`Draft text for ${candidateId}`),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeScheduleConfig(): ScheduleConfig {
  return {
    postDays: ["MON", "WED", "FRI"],
    postTime: "10:00",
    postTimezone: "UTC",
  };
}

function insertScheduledDraft(text: string): { draftId: number; scheduledId: number } {
  const draftId = storage.insertDraft(makeDraft("c1", { text, contentHash: generateContentHash(text) }));
  const now = new Date().toISOString();
  const scheduledId = storage.insertScheduledPost({
    draftId,
    scheduledAt: now, // Due immediately
    lockId: undefined,
    lockExpiresAt: undefined,
    state: "SCHEDULED",
    createdAt: now,
    updatedAt: now,
  });
  return { draftId, scheduledId };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "scheduler-test-"));
  storage = new SqliteStorage(join(tempDir, "test.db"));
  storage.initialize();
});

afterEach(() => {
  storage.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("Scheduler — pollCycle", () => {
  it("publishes due scheduled posts", async () => {
    const mockPublisher = createMockPublisher();
    const idempotent = new IdempotentPublisher(storage, mockPublisher as never);
    const scheduler = new Scheduler(storage, idempotent, {
      scheduleConfig: makeScheduleConfig(),
    });

    insertScheduledDraft("Test post content");

    const results = await scheduler.pollCycle();

    expect(results).toHaveLength(1);
    expect(results[0]?.success).toBe(true);
    expect(results[0]?.scheduledPost.state).toBe("PUBLISHED");
    expect(mockPublisher.publishText).toHaveBeenCalledOnce();
  });

  it("skips posts that are not yet due", async () => {
    const mockPublisher = createMockPublisher();
    const idempotent = new IdempotentPublisher(storage, mockPublisher as never);
    const scheduler = new Scheduler(storage, idempotent, {
      scheduleConfig: makeScheduleConfig(),
    });

    // Schedule a post for the future
    const draftId = storage.insertDraft(makeDraft("c1"));
    const futureDate = new Date(Date.now() + 3600_000).toISOString();
    storage.insertScheduledPost({
      draftId,
      scheduledAt: futureDate,
      lockId: undefined,
      lockExpiresAt: undefined,
      state: "SCHEDULED",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const results = await scheduler.pollCycle();

    expect(results).toHaveLength(0);
    expect(mockPublisher.publishText).not.toHaveBeenCalled();
  });

  it("handles multiple due posts in sequence", async () => {
    const mockPublisher = createMockPublisher();
    const idempotent = new IdempotentPublisher(storage, mockPublisher as never);
    const scheduler = new Scheduler(storage, idempotent, {
      scheduleConfig: makeScheduleConfig(),
    });

    insertScheduledDraft("Post one");
    insertScheduledDraft("Post two");
    insertScheduledDraft("Post three");

    const results = await scheduler.pollCycle();

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.success)).toBe(true);
    expect(mockPublisher.publishText).toHaveBeenCalledTimes(3);
  });

  it("marks failed posts as FAILED", async () => {
    const mockPublisher = createMockPublisher();
    mockPublisher.publishText.mockResolvedValue({
      success: false,
      error: "Auth failed",
    });
    const idempotent = new IdempotentPublisher(storage, mockPublisher as never);
    const scheduler = new Scheduler(storage, idempotent, {
      scheduleConfig: makeScheduleConfig(),
      retryConfig: { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0, jitterFactor: 0 },
    });

    const { scheduledId } = insertScheduledDraft("Failing post");

    const results = await scheduler.pollCycle();

    expect(results).toHaveLength(1);
    expect(results[0]?.success).toBe(false);
    expect(results[0]?.failureCategory).toBe("AUTH_ERROR");
    expect(storage.getScheduledPost(scheduledId)?.state).toBe("FAILED");
  });

  it("retries retryable failures", async () => {
    const mockPublisher = createMockPublisher();
    // First call fails, second succeeds
    mockPublisher.publishText.mockResolvedValueOnce({ success: false, error: "ETIMEDOUT" }).mockResolvedValueOnce({
      success: true,
      postId: "99999",
      postUrn: "urn:li:share:99999",
      postUrl: "https://linkedin.com/posts/99999",
    });

    const idempotent = new IdempotentPublisher(storage, mockPublisher as never);
    const scheduler = new Scheduler(storage, idempotent, {
      scheduleConfig: makeScheduleConfig(),
      retryConfig: { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 100, jitterFactor: 0 },
    });

    insertScheduledDraft("Retry post");

    const results = await scheduler.pollCycle();

    expect(results).toHaveLength(1);
    expect(results[0]?.success).toBe(true);
    expect(results[0]?.attempts).toBe(2);
    expect(mockPublisher.publishText).toHaveBeenCalledTimes(2);
  });

  it("exhausts retries for persistent retryable failures", async () => {
    const mockPublisher = createMockPublisher();
    mockPublisher.publishText.mockResolvedValue({
      success: false,
      error: "ETIMEDOUT",
    });

    const idempotent = new IdempotentPublisher(storage, mockPublisher as never);
    const scheduler = new Scheduler(storage, idempotent, {
      scheduleConfig: makeScheduleConfig(),
      retryConfig: { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 100, jitterFactor: 0 },
    });

    const { scheduledId } = insertScheduledDraft("Persistent failure");

    const results = await scheduler.pollCycle();

    expect(results).toHaveLength(1);
    expect(results[0]?.success).toBe(false);
    expect(results[0]?.failureCategory).toBe("NETWORK_ERROR");
    expect(results[0]?.attempts).toBe(3); // 1 initial + 2 retries
    expect(storage.getScheduledPost(scheduledId)?.state).toBe("FAILED");
  });

  it("does not retry non-retryable failures", async () => {
    const mockPublisher = createMockPublisher();
    mockPublisher.publishText.mockResolvedValue({
      success: false,
      error: "401 Unauthorized",
    });

    const idempotent = new IdempotentPublisher(storage, mockPublisher as never);
    const scheduler = new Scheduler(storage, idempotent, {
      scheduleConfig: makeScheduleConfig(),
      retryConfig: { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100, jitterFactor: 0 },
    });

    insertScheduledDraft("Auth failure");

    const results = await scheduler.pollCycle();

    expect(results).toHaveLength(1);
    expect(results[0]?.attempts).toBe(1); // No retries for auth errors
  });

  it("invokes onPublish callback", async () => {
    const mockPublisher = createMockPublisher();
    const idempotent = new IdempotentPublisher(storage, mockPublisher as never);
    const onPublish = vi.fn();
    const scheduler = new Scheduler(storage, idempotent, {
      scheduleConfig: makeScheduleConfig(),
      onPublish,
    });

    insertScheduledDraft("Callback post");

    await scheduler.pollCycle();

    expect(onPublish).toHaveBeenCalledOnce();
    expect(onPublish).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it("returns empty results when no posts are due", async () => {
    const mockPublisher = createMockPublisher();
    const idempotent = new IdempotentPublisher(storage, mockPublisher as never);
    const scheduler = new Scheduler(storage, idempotent, {
      scheduleConfig: makeScheduleConfig(),
    });

    const results = await scheduler.pollCycle();

    expect(results).toHaveLength(0);
    expect(mockPublisher.publishText).not.toHaveBeenCalled();
  });
});

describe("Scheduler — start/stop", () => {
  it("tracks running state", async () => {
    const mockPublisher = createMockPublisher();
    const idempotent = new IdempotentPublisher(storage, mockPublisher as never);
    const scheduler = new Scheduler(storage, idempotent, {
      scheduleConfig: makeScheduleConfig(),
      pollIntervalMs: 100,
    });

    expect(scheduler.isRunning()).toBe(false);

    // Start in background
    const abortController = new AbortController();
    const startPromise = scheduler.start({ signal: abortController.signal });

    // Wait a tick for polling to start
    await new Promise((r) => setTimeout(r, 50));
    expect(scheduler.isRunning()).toBe(true);

    // Stop
    abortController.abort();
    await startPromise;
    expect(scheduler.isRunning()).toBe(false);
  });

  it("tracks worker statistics", async () => {
    const mockPublisher = createMockPublisher();
    const idempotent = new IdempotentPublisher(storage, mockPublisher as never);
    const scheduler = new Scheduler(storage, idempotent, {
      scheduleConfig: makeScheduleConfig(),
      pollIntervalMs: 100,
    });

    insertScheduledDraft("Stats post");

    const abortController = new AbortController();
    const startPromise = scheduler.start({ signal: abortController.signal });

    // Wait for at least one poll cycle
    await new Promise((r) => setTimeout(r, 200));

    abortController.abort();
    await startPromise;

    const stats = scheduler.getStats();
    expect(stats.pollCycles).toBeGreaterThanOrEqual(1);
    expect(stats.postsAttempted).toBeGreaterThanOrEqual(1);
    expect(stats.postsPublished).toBeGreaterThanOrEqual(1);
    expect(stats.startedAt).toBeDefined();
  });
});

describe("Scheduler — idempotency", () => {
  it("skips already-published content", async () => {
    const mockPublisher = createMockPublisher();
    const idempotent = new IdempotentPublisher(storage, mockPublisher as never);
    const scheduler = new Scheduler(storage, idempotent, {
      scheduleConfig: makeScheduleConfig(),
    });

    const text = "Already published content";
    insertScheduledDraft(text);

    // First publish
    await scheduler.pollCycle();

    // Insert another scheduled post with same text
    insertScheduledDraft(text);

    // Second publish should detect duplicate
    const results = await scheduler.pollCycle();

    expect(results).toHaveLength(1);
    expect(results[0]?.alreadyPublished).toBe(true);
    // LinkedIn API should only be called once (for the first post)
    expect(mockPublisher.publishText).toHaveBeenCalledOnce();
  });
});
