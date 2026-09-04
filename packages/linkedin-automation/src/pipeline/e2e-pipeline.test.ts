// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

import { SqliteStorage } from "../storage/sqlite-storage.js";
import { IdempotentPublisher } from "../storage/idempotent-publisher.js";
import { ContentValidator } from "../agents/content-validator.js";
import { writeDraft } from "../agents/writer.js";
import {
  createDeduplicationStore,
  isDuplicateDraft,
  markDraftAsSeen,
} from "./deduplication.js";
import { Scheduler } from "../scheduler/scheduler.js";

describe("End-to-End Autonomous Pipeline Integration", () => {
  let tempDir: string;
  let dbPath: string;
  let storage: SqliteStorage;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pipeline-e2e-"));
    dbPath = join(tempDir, "test-automation.db");
    storage = new SqliteStorage(dbPath);
    storage.initialize();
  });

  afterEach(() => {
    storage.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("executes full pipeline: Research → Generate → Validate → Media → Approve → Queue → Atomic Claim → Publish → Store Result", async () => {
    // -------------------------------------------------------------
    // 1. Research & Fact Extraction
    // -------------------------------------------------------------
    const extractedFacts = [
      {
        id: "fact-1",
        claim: "Migrated transaction isolation level to Read Committed in our Postgres database layer",
        confidence: 0.95,
        source: "commit-4f1a2b",
      },
      {
        id: "fact-2",
        claim: "Eliminated transaction lock serialization contention under 5,000 concurrent requests/sec",
        confidence: 0.92,
        source: "benchmark-report",
      },
      {
        id: "fact-3",
        claim: "Reduced p99 query latency from 185ms down to 14ms across all active production API shards",
        confidence: 0.90,
        source: "datadog-metrics",
      },
    ];

    // -------------------------------------------------------------
    // 2. Technical Content Generation (Senior Engineer voice)
    // -------------------------------------------------------------
    const draftContent = writeDraft(extractedFacts, { maxWords: 200, includeHashtags: true });
    expect(draftContent.text).toContain("Postgres");
    expect(draftContent.text).toContain("p99");

    // -------------------------------------------------------------
    // 3. Strict Content Validation & Quality Scoring
    // -------------------------------------------------------------
    const validation = ContentValidator.validate(draftContent.text);
    expect(validation.valid).toBe(true);
    expect(validation.canPublish).toBe(true);
    expect(validation.metrics.technicalValue).toBeGreaterThanOrEqual(60);

    // -------------------------------------------------------------
    // 4. Media Generation / Preparation
    // -------------------------------------------------------------
    const testImagePath = join(tempDir, "architecture-diagram.png");
    // Write valid test image buffer
    writeFileSync(testImagePath, Buffer.from("89504E470D0A1A0A0000000D49484452", "hex"));

    // -------------------------------------------------------------
    // 5. Semantic Deduplication Check
    // -------------------------------------------------------------
    const dedupeStore = createDeduplicationStore();
    const dupCheck = isDuplicateDraft(draftContent.text, dedupeStore);
    expect(dupCheck.isDuplicate).toBe(false);
    markDraftAsSeen(draftContent.text, dedupeStore);

    // -------------------------------------------------------------
    // 6. Review & Approval Flow
    // -------------------------------------------------------------
    const draftId = storage.insertDraft({
      candidateId: "cand-postgres-opt",
      text: draftContent.text,
      wordCount: draftContent.wordCount,
      factsUsed: draftContent.factsUsed,
      slopScore: validation.metrics.spamRisk,
      verificationSummary: "3 verified facts",
      reviewDecision: "APPROVED",
      reviewScore: validation.metrics.overallScore,
      suggestions: [],
      imagePath: testImagePath,
      state: "APPROVED",
      contentHash: "hash-postgres-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const insertedDraft = storage.getDraft(draftId);
    expect(insertedDraft).toBeDefined();
    expect(insertedDraft?.imagePath).toBe(testImagePath);
    expect(insertedDraft?.state).toBe("APPROVED");

    // -------------------------------------------------------------
    // 7. Enqueue into Scheduler (UTC timestamp)
    // -------------------------------------------------------------
    const scheduledAtUtc = new Date(Date.now() - 1000).toISOString(); // due right now
    const scheduledId = storage.insertScheduledPost({
      draftId,
      scheduledAt: scheduledAtUtc,
      lockId: undefined,
      lockExpiresAt: undefined,
      state: "SCHEDULED",
      attempts: 0,
      createdAt: scheduledAtUtc,
      updatedAt: scheduledAtUtc,
    });

    // -------------------------------------------------------------
    // 8. Mock LinkedCtl Publisher with Preflight
    // -------------------------------------------------------------
    const mockPublisher = {
      preflightCheck: vi.fn().mockResolvedValue({
        authenticated: true,
        activeProfile: "default",
        isExpired: false,
        scopes: {
          granted: ["openid", "profile", "email", "w_member_social"],
          required: ["openid", "profile", "email", "w_member_social"],
          missing: [],
          canPost: true,
        },
        apiVersion: "202601",
      }),
      publishText: vi.fn().mockResolvedValue({ success: true }),
      publishImage: vi.fn().mockResolvedValue({
        success: true,
        postId: "share-889900",
        postUrn: "urn:li:share:889900",
        postUrl: "https://www.linkedin.com/feed/update/urn:li:share:889900",
      }),
      getAccount: vi.fn().mockResolvedValue({
        sub: "user-123",
        name: "Test Engineer",
        personUrn: "urn:li:person:user-123",
      }),
    };

    const idempotent = new IdempotentPublisher(storage, mockPublisher as never);

    // -------------------------------------------------------------
    // 9. Atomic Worker Claim & Publishing
    // -------------------------------------------------------------
    const scheduler = new Scheduler(storage, idempotent);
    const publishResults = await scheduler.pollCycle();

    // Verification
    expect(publishResults).toHaveLength(1);
    expect(publishResults[0]?.success).toBe(true);
    expect(publishResults[0]?.alreadyPublished).toBe(false);

    // Media publish must have been used because imagePath was attached
    expect(mockPublisher.publishImage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: draftContent.text,
        imagePath: testImagePath,
      }),
    );

    // -------------------------------------------------------------
    // 10. Store Result & Post Verification
    // -------------------------------------------------------------
    const published = storage.getAllPublishedPosts();
    expect(published).toHaveLength(1);
    expect(published[0]?.linkedinPostUrn).toBe("urn:li:share:889900");
    expect(published[0]?.draftId).toBe(draftId);

    const updatedScheduled = storage.getScheduledPost(scheduledId);
    expect(updatedScheduled?.state).toBe("PUBLISHED");

    const updatedDraft = storage.getDraft(draftId);
    expect(updatedDraft?.state).toBe("PUBLISHED");
  });
});
