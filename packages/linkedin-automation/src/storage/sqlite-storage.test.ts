// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { SqliteStorage } from "./sqlite-storage.js";
import type { ContentCandidateRecord, PostDraftRecord, ScheduledPostRecord } from "./types.js";

let storage: SqliteStorage;
let tempDir: string;

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
    contentHash: `hash-${id}`,
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
    state: "DRAFT",
    contentHash: `draft-hash-${candidateId}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "sqlite-test-"));
  storage = new SqliteStorage(join(tempDir, "test.db"));
  storage.initialize();
});

afterEach(() => {
  storage.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("SqliteStorage — Content Candidates", () => {
  it("inserts and retrieves a candidate", () => {
    const candidate = makeCandidate("c1");
    storage.insertCandidate(candidate);

    const retrieved = storage.getCandidate("c1");
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe("c1");
    expect(retrieved?.repo).toBe("owner/repo");
    expect(retrieved?.facts).toEqual(["Fact one", "Fact two"]);
    expect(retrieved?.supportingCommits).toEqual(["abc123"]);
  });

  it("returns undefined for non-existent candidate", () => {
    expect(storage.getCandidate("nonexistent")).toBeUndefined();
  });

  it("updates candidate state", () => {
    const candidate = makeCandidate("c1");
    storage.insertCandidate(candidate);

    storage.updateCandidateState("c1", "ANALYZING");

    const retrieved = storage.getCandidate("c1");
    expect(retrieved?.state).toBe("ANALYZING");
  });

  it("gets candidates by state", () => {
    storage.insertCandidate(makeCandidate("c1", { state: "DISCOVERED" }));
    storage.insertCandidate(makeCandidate("c2", { state: "ANALYZING" }));
    storage.insertCandidate(makeCandidate("c3", { state: "DISCOVERED" }));

    const discovered = storage.getCandidatesByState("DISCOVERED");
    expect(discovered).toHaveLength(2);
    expect(discovered[0]?.id).toBe("c1");
    expect(discovered[1]?.id).toBe("c3");
  });

  it("gets all candidates", () => {
    storage.insertCandidate(makeCandidate("c1"));
    storage.insertCandidate(makeCandidate("c2"));

    const all = storage.getAllCandidates();
    expect(all).toHaveLength(2);
  });

  it("detects candidate by content hash", () => {
    storage.insertCandidate(makeCandidate("c1", { contentHash: "abc123" }));

    expect(storage.candidateExistsByHash("abc123")).toBe(true);
    expect(storage.candidateExistsByHash("xyz")).toBe(false);
  });

  it("tracks source IDs", () => {
    expect(storage.sourceIdExists("sha-1")).toBe(false);

    storage.recordSourceId("sha-1");
    expect(storage.sourceIdExists("sha-1")).toBe(true);
    expect(storage.sourceIdExists("sha-2")).toBe(false);
  });

  it("handles duplicate source IDs gracefully", () => {
    storage.recordSourceId("sha-1");
    storage.recordSourceId("sha-1"); // Should not throw
    expect(storage.sourceIdExists("sha-1")).toBe(true);
  });
});

describe("SqliteStorage — Post Drafts", () => {
  it("inserts and retrieves a draft", () => {
    const draft = makeDraft("c1");
    const id = storage.insertDraft(draft);

    const retrieved = storage.getDraft(id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.candidateId).toBe("c1");
    expect(retrieved?.text).toBe("Draft text for c1");
    expect(retrieved?.factsUsed).toEqual(["fact-1"]);
  });

  it("returns undefined for non-existent draft", () => {
    expect(storage.getDraft(999)).toBeUndefined();
  });

  it("updates draft state", () => {
    const id = storage.insertDraft(makeDraft("c1"));

    storage.updateDraftState(id, "APPROVED");

    const retrieved = storage.getDraft(id);
    expect(retrieved?.state).toBe("APPROVED");
  });

  it("gets drafts by state", () => {
    storage.insertDraft(makeDraft("c1", { state: "DRAFT" }));
    storage.insertDraft(makeDraft("c2", { state: "APPROVED" }));
    storage.insertDraft(makeDraft("c3", { state: "DRAFT" }));

    const drafts = storage.getDraftsByState("DRAFT");
    expect(drafts).toHaveLength(2);
  });

  it("detects draft by content hash", () => {
    storage.insertDraft(makeDraft("c1", { contentHash: "hash-abc" }));

    expect(storage.draftExistsByHash("hash-abc")).toBe(true);
    expect(storage.draftExistsByHash("hash-xyz")).toBe(false);
  });
});

describe("SqliteStorage — Scheduled Posts", () => {
  it("inserts and retrieves a scheduled post", () => {
    const draftId = storage.insertDraft(makeDraft("c1"));
    const now = new Date().toISOString();
    const scheduled: Omit<ScheduledPostRecord, "id"> = {
      draftId,
      scheduledAt: now,
      lockId: undefined,
      lockExpiresAt: undefined,
      state: "SCHEDULED",
      createdAt: now,
      updatedAt: now,
    };

    const id = storage.insertScheduledPost(scheduled);
    const retrieved = storage.getScheduledPost(id);

    expect(retrieved).toBeDefined();
    expect(retrieved?.draftId).toBe(draftId);
    expect(retrieved?.state).toBe("SCHEDULED");
  });

  it("acquires and releases publish lock", () => {
    const draftId = storage.insertDraft(makeDraft("c1"));
    const now = new Date().toISOString();
    const id = storage.insertScheduledPost({
      draftId,
      scheduledAt: now,
      lockId: undefined,
      lockExpiresAt: undefined,
      state: "SCHEDULED",
      createdAt: now,
      updatedAt: now,
    });

    // Acquire lock
    const lockId = storage.acquirePublishLock(id, "lock-1", 60_000);
    expect(lockId).toBe("lock-1");

    // Cannot acquire again (already locked)
    const secondAttempt = storage.acquirePublishLock(id, "lock-2", 60_000);
    expect(secondAttempt).toBeUndefined();

    // Release lock
    storage.releasePublishLock(id, "lock-1");

    // Can acquire again
    const thirdAttempt = storage.acquirePublishLock(id, "lock-3", 60_000);
    expect(thirdAttempt).toBe("lock-3");
  });

  it("gets next scheduled post", () => {
    const draftId = storage.insertDraft(makeDraft("c1"));
    const now = new Date().toISOString();

    storage.insertScheduledPost({
      draftId,
      scheduledAt: now,
      lockId: undefined,
      lockExpiresAt: undefined,
      state: "SCHEDULED",
      createdAt: now,
      updatedAt: now,
    });

    const next = storage.getNextScheduledPost();
    expect(next).toBeDefined();
    expect(next?.draftId).toBe(draftId);
  });

  it("skips locked posts when getting next", () => {
    const draftId = storage.insertDraft(makeDraft("c1"));
    const now = new Date().toISOString();

    const id = storage.insertScheduledPost({
      draftId,
      scheduledAt: now,
      lockId: undefined,
      lockExpiresAt: undefined,
      state: "SCHEDULED",
      createdAt: now,
      updatedAt: now,
    });

    storage.acquirePublishLock(id, "lock-1", 60_000);

    const next = storage.getNextScheduledPost();
    expect(next).toBeUndefined();
  });

  it("atomically claims and locks next scheduled post", () => {
    const draftId = storage.insertDraft(makeDraft("c1"));
    const now = new Date().toISOString();

    const id = storage.insertScheduledPost({
      draftId,
      scheduledAt: now,
      lockId: undefined,
      lockExpiresAt: undefined,
      state: "SCHEDULED",
      createdAt: now,
      updatedAt: now,
    });

    const claimed = storage.claimNextScheduledPost("worker-lock-1", 60_000);
    expect(claimed).toBeDefined();
    expect(claimed?.id).toBe(id);
    expect(claimed?.state).toBe("PROCESSING");
    expect(claimed?.lockId).toBe("worker-lock-1");

    // Second claim attempt must return undefined (cannot claim already claimed job)
    const secondClaim = storage.claimNextScheduledPost("worker-lock-2", 60_000);
    expect(secondClaim).toBeUndefined();
  });

  it("updates draft media and persists image path", () => {
    const draftId = storage.insertDraft(makeDraft("c1"));
    storage.updateDraftMedia(draftId, "/media/photos/test.png", "urn:li:image:12345");

    const draft = storage.getDraft(draftId);
    expect(draft?.imagePath).toBe("/media/photos/test.png");
    expect(draft?.mediaUrn).toBe("urn:li:image:12345");
  });
});

describe("SqliteStorage — Published Posts", () => {
  it("inserts and retrieves published posts", () => {
    const draftId = storage.insertDraft(makeDraft("c1"));
    const now = new Date().toISOString();

    storage.insertPublishedPost({
      draftId,
      linkedinPostId: "12345",
      linkedinPostUrn: "urn:li:share:12345",
      linkedinPostUrl: "https://linkedin.com/posts/12345",
      contentHash: "hash-123",
      publishedAt: now,
      createdAt: now,
    });

    const all = storage.getAllPublishedPosts();
    expect(all).toHaveLength(1);
    expect(all[0]?.linkedinPostUrn).toBe("urn:li:share:12345");
  });

  it("detects published post by content hash", () => {
    const draftId = storage.insertDraft(makeDraft("c1"));
    const now = new Date().toISOString();

    storage.insertPublishedPost({
      draftId,
      linkedinPostId: "12345",
      linkedinPostUrn: "urn:li:share:12345",
      linkedinPostUrl: "",
      contentHash: "hash-abc",
      publishedAt: now,
      createdAt: now,
    });

    expect(storage.publishedPostExistsByHash("hash-abc")).toBe(true);
    expect(storage.publishedPostExistsByHash("hash-xyz")).toBe(false);
  });

  it("gets published post by URN", () => {
    const draftId = storage.insertDraft(makeDraft("c1"));
    const now = new Date().toISOString();

    storage.insertPublishedPost({
      draftId,
      linkedinPostId: "12345",
      linkedinPostUrn: "urn:li:share:12345",
      linkedinPostUrl: "",
      contentHash: "hash-abc",
      publishedAt: now,
      createdAt: now,
    });

    const post = storage.getPublishedPostByUrn("urn:li:share:12345");
    expect(post).toBeDefined();
    expect(post?.linkedinPostId).toBe("12345");

    expect(storage.getPublishedPostByUrn("urn:li:share:99999")).toBeUndefined();
  });
});

describe("SqliteStorage — Automation Settings", () => {
  it("returns default settings when none exist", () => {
    const settings = storage.getSettings();
    expect(settings.lookbackDays).toBe(7);
    expect(settings.scoreThreshold).toBe(5);
    expect(settings.maxWords).toBe(300);
    expect(settings.includeHashtags).toBe(true);
  });

  it("updates settings", () => {
    storage.updateSettings({
      lookbackDays: 14,
      scoreThreshold: 3,
      maxWords: 500,
      includeHashtags: false,
      minPostIntervalMs: 7200000,
      automationMode: "safe",
      approvalWindowHours: 48,
    });

    const settings = storage.getSettings();
    expect(settings.lookbackDays).toBe(14);
    expect(settings.scoreThreshold).toBe(3);
    expect(settings.maxWords).toBe(500);
    expect(settings.includeHashtags).toBe(false);
  });

  it("returns same settings on repeated getSettings calls", () => {
    const s1 = storage.getSettings();
    const s2 = storage.getSettings();
    expect(s1.lookbackDays).toBe(s2.lookbackDays);
  });
});

describe("SqliteStorage — State Transitions", () => {
  it("updates candidate through lifecycle", () => {
    storage.insertCandidate(makeCandidate("c1"));

    storage.updateCandidateState("c1", "ANALYZING");
    expect(storage.getCandidate("c1")?.state).toBe("ANALYZING");

    storage.updateCandidateState("c1", "DRAFT");
    expect(storage.getCandidate("c1")?.state).toBe("DRAFT");

    storage.updateCandidateState("c1", "REVIEW_REQUIRED");
    expect(storage.getCandidate("c1")?.state).toBe("REVIEW_REQUIRED");

    storage.updateCandidateState("c1", "APPROVED");
    expect(storage.getCandidate("c1")?.state).toBe("APPROVED");
  });

  it("updates draft through lifecycle", () => {
    const id = storage.insertDraft(makeDraft("c1"));

    storage.updateDraftState(id, "APPROVED");
    expect(storage.getDraft(id)?.state).toBe("APPROVED");

    storage.updateDraftState(id, "PUBLISHED");
    expect(storage.getDraft(id)?.state).toBe("PUBLISHED");
  });
});
