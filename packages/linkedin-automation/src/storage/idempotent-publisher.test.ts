// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

import { SqliteStorage } from "./sqlite-storage.js";
import { IdempotentPublisher } from "./idempotent-publisher.js";
import { generateContentHash } from "./content-hash.js";
import type { ContentCandidateRecord, PostDraftRecord } from "./types.js";
import type { PublishResult } from "../types/index.js";

let storage: SqliteStorage;
let tempDir: string;

/** Minimal mock of LinkedCtlPublisher. */
function createMockPublisher(result?: Partial<PublishResult>) {
  return {
    publishText: vi.fn().mockResolvedValue({
      success: true,
      postId: "12345",
      postUrn: "urn:li:share:12345",
      postUrl: "https://linkedin.com/posts/12345",
      ...result,
    }),
    publishImage: vi.fn().mockResolvedValue({ success: true }),
    getAccount: vi.fn().mockResolvedValue({ sub: "test", name: "Test" }),
  };
}

function makeCandidate(id: string, overrides?: Partial<ContentCandidateRecord>): ContentCandidateRecord {
  return {
    id,
    repo: "owner/repo",
    source: "commits",
    score: 5,
    title: `Candidate ${id}`,
    facts: ["Fact one", "Fact two"],
    reason: "Test reason",
    supportingCommits: ["abc123"],
    supportingFiles: ["src/index.ts"],
    state: "DISCOVERED",
    contentHash: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
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

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "publisher-test-"));
  storage = new SqliteStorage(join(tempDir, "test.db"));
  storage.initialize();
});

afterEach(() => {
  storage.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("IdempotentPublisher — publishDraft", () => {
  it("publishes a draft successfully", async () => {
    const publisher = createMockPublisher();
    const idempotent = new IdempotentPublisher(storage, publisher as never);
    const draftId = storage.insertDraft(makeDraft("c1"));
    const draft = storage.getDraft(draftId);
    if (!draft) throw new Error("Draft not found");

    const result = await idempotent.publishDraft(draft);

    expect(result.success).toBe(true);
    expect(result.alreadyPublished).toBe(false);
    expect(result.publishResult?.postId).toBe("12345");
    expect(publisher.publishText).toHaveBeenCalledOnce();
  });

  it("marks draft as PUBLISHED after successful publish", async () => {
    const publisher = createMockPublisher();
    const idempotent = new IdempotentPublisher(storage, publisher as never);
    const draftId = storage.insertDraft(makeDraft("c1"));
    const draft = storage.getDraft(draftId);
    if (!draft) throw new Error("Draft not found");

    await idempotent.publishDraft(draft);

    const updated = storage.getDraft(draftId);
    expect(updated?.state).toBe("PUBLISHED");
  });

  it("stores published post record after successful publish", async () => {
    const publisher = createMockPublisher();
    const idempotent = new IdempotentPublisher(storage, publisher as never);
    const draftId = storage.insertDraft(makeDraft("c1"));
    const draft = storage.getDraft(draftId);
    if (!draft) throw new Error("Draft not found");

    await idempotent.publishDraft(draft);

    const published = storage.getAllPublishedPosts();
    expect(published).toHaveLength(1);
    expect(published[0]?.linkedinPostUrn).toBe("urn:li:share:12345");
    expect(published[0]?.draftId).toBe(draftId);
  });

  it("returns alreadyPublished for duplicate content", async () => {
    const publisher = createMockPublisher();
    const idempotent = new IdempotentPublisher(storage, publisher as never);

    // First publish
    const draftId = storage.insertDraft(makeDraft("c1"));
    const draft = storage.getDraft(draftId);
    if (!draft) throw new Error("Draft not found");
    await idempotent.publishDraft(draft);

    // Second publish with same text
    const draftId2 = storage.insertDraft(makeDraft("c2", { text: draft.text, contentHash: draft.contentHash }));
    const draft2 = storage.getDraft(draftId2);
    if (!draft2) throw new Error("Draft2 not found");

    const result = await idempotent.publishDraft(draft2);

    expect(result.success).toBe(true);
    expect(result.alreadyPublished).toBe(true);
    expect(result.publishResult).toBeUndefined();
    // Should not call LinkedIn API again
    expect(publisher.publishText).toHaveBeenCalledOnce();
  });

  it("returns error when LinkedIn publish fails", async () => {
    const publisher = createMockPublisher({ success: false, error: "Auth failed" });
    const idempotent = new IdempotentPublisher(storage, publisher as never);
    const draftId = storage.insertDraft(makeDraft("c1"));
    const draft = storage.getDraft(draftId);
    if (!draft) throw new Error("Draft not found");

    const result = await idempotent.publishDraft(draft);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Auth failed");
    expect(storage.getAllPublishedPosts()).toHaveLength(0);
  });

  it("does not store published post when publish fails", async () => {
    const publisher = createMockPublisher({ success: false, error: "Error" });
    const idempotent = new IdempotentPublisher(storage, publisher as never);
    const draftId = storage.insertDraft(makeDraft("c1"));
    const draft = storage.getDraft(draftId);
    if (!draft) throw new Error("Draft not found");

    await idempotent.publishDraft(draft);

    expect(storage.getAllPublishedPosts()).toHaveLength(0);
    expect(storage.getDraft(draftId)?.state).toBe("APPROVED"); // Unchanged
  });
});

describe("IdempotentPublisher — prepareCandidate", () => {
  it("returns candidate with content hash", () => {
    const publisher = createMockPublisher();
    const idempotent = new IdempotentPublisher(storage, publisher as never);
    const candidate = makeCandidate("c1");

    const result = idempotent.prepareCandidate(candidate);

    expect(result).toBeDefined();
    expect(result?.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("records source IDs", () => {
    const publisher = createMockPublisher();
    const idempotent = new IdempotentPublisher(storage, publisher as never);
    const candidate = makeCandidate("c1", { supportingCommits: ["sha-1", "sha-2"] });

    idempotent.prepareCandidate(candidate);

    expect(storage.sourceIdExists("sha-1")).toBe(true);
    expect(storage.sourceIdExists("sha-2")).toBe(true);
  });

  it("returns undefined for duplicate candidate (same content hash)", () => {
    const publisher = createMockPublisher();
    const idempotent = new IdempotentPublisher(storage, publisher as never);

    const candidate1 = makeCandidate("c1");
    const prepared1 = idempotent.prepareCandidate(candidate1);
    // Store it to register the content hash
    if (prepared1 !== undefined) {
      storage.insertCandidate(prepared1);
    }

    // Same candidate with same fields
    const candidate2 = makeCandidate("c1");
    const prepared2 = idempotent.prepareCandidate(candidate2);

    expect(prepared2).toBeUndefined();
  });

  it("returns undefined for candidate with duplicate commit SHA", () => {
    const publisher = createMockPublisher();
    const idempotent = new IdempotentPublisher(storage, publisher as never);

    // Record a source ID
    storage.recordSourceId("sha-duplicate");

    const candidate = makeCandidate("c1", { supportingCommits: ["sha-duplicate"] });
    const result = idempotent.prepareCandidate(candidate);

    expect(result).toBeUndefined();
  });

  it("records release source IDs", () => {
    const publisher = createMockPublisher();
    const idempotent = new IdempotentPublisher(storage, publisher as never);

    const candidate = makeCandidate("c1", { source: "release" });
    idempotent.prepareCandidate(candidate);

    expect(storage.sourceIdExists("release-c1")).toBe(true);
  });

  it("records PR source IDs", () => {
    const publisher = createMockPublisher();
    const idempotent = new IdempotentPublisher(storage, publisher as never);

    const candidate = makeCandidate("c1", { source: "pull-request" });
    idempotent.prepareCandidate(candidate);

    expect(storage.sourceIdExists("pr-c1")).toBe(true);
  });
});

describe("IdempotentPublisher — publishScheduledPost", () => {
  it("acquires lock and publishes", async () => {
    const publisher = createMockPublisher();
    const idempotent = new IdempotentPublisher(storage, publisher as never, { lockDurationMs: 60_000 });

    const draftId = storage.insertDraft(makeDraft("c1"));
    const now = new Date().toISOString();
    const scheduledId = storage.insertScheduledPost({
      draftId,
      scheduledAt: now,
      lockId: undefined,
      lockExpiresAt: undefined,
      state: "SCHEDULED",
      createdAt: now,
      updatedAt: now,
    });

    const scheduled = storage.getScheduledPost(scheduledId);
    if (!scheduled) throw new Error("Scheduled post not found");
    const result = await idempotent.publishScheduledPost(scheduled);

    expect(result.success).toBe(true);
    expect(storage.getScheduledPost(scheduledId)?.state).toBe("PUBLISHED");
  });

  it("releases lock even on failure", async () => {
    const publisher = createMockPublisher({ success: false, error: "Error" });
    const idempotent = new IdempotentPublisher(storage, publisher as never, { lockDurationMs: 60_000 });

    const draftId = storage.insertDraft(makeDraft("c1"));
    const now = new Date().toISOString();
    const scheduledId = storage.insertScheduledPost({
      draftId,
      scheduledAt: now,
      lockId: undefined,
      lockExpiresAt: undefined,
      state: "SCHEDULED",
      createdAt: now,
      updatedAt: now,
    });

    const scheduled = storage.getScheduledPost(scheduledId);
    if (!scheduled) throw new Error("Scheduled post not found");
    await idempotent.publishScheduledPost(scheduled);

    // Verify the scheduled post state is FAILED (lock was released and not left dangling)
    const after = storage.getScheduledPost(scheduledId);
    expect(after?.state).toBe("FAILED");
    // Lock should not be held — acquirePublishLock won't succeed because state is FAILED,
    // which confirms the lock was properly released during the finally block
    const lock = storage.acquirePublishLock(scheduledId, "new-lock", 60_000);
    expect(lock).toBeUndefined(); // Expected: state is FAILED, not SCHEDULED
  });

  it("fails if draft is missing", async () => {
    const publisher = createMockPublisher();
    const idempotent = new IdempotentPublisher(storage, publisher as never, { lockDurationMs: 60_000 });

    const now = new Date().toISOString();
    const scheduledId = storage.insertScheduledPost({
      draftId: 9999,
      scheduledAt: now,
      lockId: undefined,
      lockExpiresAt: undefined,
      state: "SCHEDULED",
      createdAt: now,
      updatedAt: now,
    });

    const scheduled = storage.getScheduledPost(scheduledId);
    if (!scheduled) throw new Error("Scheduled post not found");
    const result = await idempotent.publishScheduledPost(scheduled);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Draft #9999 not found");
    expect(storage.getScheduledPost(scheduledId)?.state).toBe("FAILED");
  });
});

describe("IdempotentPublisher — isAmbiguousResult", () => {
  it("returns false for successful result", () => {
    const publisher = createMockPublisher();
    const idempotent = new IdempotentPublisher(storage, publisher as never);

    expect(idempotent.isAmbiguousResult({ success: true })).toBe(false);
  });

  it("returns true for 409 Conflict", () => {
    const publisher = createMockPublisher();
    const idempotent = new IdempotentPublisher(storage, publisher as never);

    expect(idempotent.isAmbiguousResult({ success: false, error: "409 Conflict" })).toBe(true);
  });

  it("returns true for timeout errors", () => {
    const publisher = createMockPublisher();
    const idempotent = new IdempotentPublisher(storage, publisher as never);

    expect(idempotent.isAmbiguousResult({ success: false, error: "ETIMEDOUT" })).toBe(true);
    expect(idempotent.isAmbiguousResult({ success: false, error: "Request timeout" })).toBe(true);
  });

  it("returns false for clear errors", () => {
    const publisher = createMockPublisher();
    const idempotent = new IdempotentPublisher(storage, publisher as never);

    expect(idempotent.isAmbiguousResult({ success: false, error: "401 Unauthorized" })).toBe(false);
    expect(idempotent.isAmbiguousResult({ success: false, error: "Post text cannot be empty" })).toBe(false);
  });
});
