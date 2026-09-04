// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Idempotent publisher for LinkedIn posts.
 *
 * Before publishing:
 * 1. Normalize content
 * 2. Generate contentHash and deterministic idempotencyKey
 * 3. Verify source IDs and idempotency key haven't been published before
 * 4. Check previous published posts for duplicates
 * 5. Acquire publishing lock
 * 6. Publish (text or image based on draft.imagePath)
 * 7. Store LinkedIn post ID/URN and idempotencyKey
 * 8. Mark PUBLISHED
 *
 * Does NOT blindly retry if LinkedIn returned an unknown network state.
 * Prevents duplicates via content hash and source ID tracking.
 */

import { randomUUID, createHash } from "node:crypto";
import { existsSync } from "node:fs";

import type { LinkedCtlPublisher } from "../linkedin/linkedctl-publisher.js";
import type { PublishResult } from "../types/index.js";
import type { StoragePort } from "./storage.js";
import type { ContentCandidateRecord, PostDraftRecord, ScheduledPostRecord } from "./types.js";
import { generateContentHash, generateCandidateHash } from "./content-hash.js";

/** Default publish lock duration (5 minutes). */
const DEFAULT_LOCK_DURATION_MS = 5 * 60 * 1000;

/**
 * Result of an idempotent publish attempt.
 */
export interface IdempotentPublishResult {
  /** Whether the publish succeeded. */
  success: boolean;
  /** Whether this was a no-op because the content was already published. */
  alreadyPublished: boolean;
  /** The publish result from LinkedIn (if published). */
  publishResult: PublishResult | undefined;
  /** Error message (if failed). */
  error: string | undefined;
  /** Content hash that was used for deduplication. */
  contentHash: string;
  /** Deterministic idempotency key. */
  idempotencyKey?: string;
}

/**
 * Generate a deterministic idempotency key for a draft.
 */
export function generateIdempotencyKey(candidateId: string, contentHash: string, mediaPath?: string): string {
  const normMedia = mediaPath ? mediaPath.trim().toLowerCase() : "";
  return createHash("sha256")
    .update(`${candidateId}:${contentHash}:${normMedia}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * IdempotentPublisher wraps LinkedIn publishing with deduplication and locking.
 */
export class IdempotentPublisher {
  private readonly storage: StoragePort;
  private readonly publisher: LinkedCtlPublisher;
  private readonly lockDurationMs: number;

  constructor(storage: StoragePort, publisher: LinkedCtlPublisher, options?: { lockDurationMs?: number }) {
    this.storage = storage;
    this.publisher = publisher;
    this.lockDurationMs = options?.lockDurationMs ?? DEFAULT_LOCK_DURATION_MS;
  }

  /**
   * Publish a draft idempotently.
   * Supports both text-only posts and posts with attached visuals.
   */
  async publishDraft(draft: PostDraftRecord): Promise<IdempotentPublishResult> {
    // 1. Normalize content and generate hash & idempotency key
    const contentHash = generateContentHash(draft.text);
    const idempotencyKey = generateIdempotencyKey(draft.candidateId, contentHash, draft.imagePath);

    // 2. Check if this content hash or idempotency key was already published
    if (this.storage.publishedPostExistsByHash(contentHash) || this.storage.publishedPostExistsByIdempotencyKey(idempotencyKey)) {
      return {
        success: true,
        alreadyPublished: true,
        publishResult: undefined,
        error: undefined,
        contentHash,
        idempotencyKey,
      };
    }

    // 3. Check if a draft with this hash already exists (prevent duplicate drafts)
    if (draft.id !== 0 && this.storage.draftExistsByHash(contentHash)) {
      const existing = this.storage.getAllDrafts().find((d) => d.contentHash === contentHash);
      if (existing !== undefined && existing.id !== draft.id) {
        return {
          success: false,
          alreadyPublished: false,
          publishResult: undefined,
          error: `Draft with identical content already exists (draft #${existing.id})`,
          contentHash,
          idempotencyKey,
        };
      }
    }

    // 4. Try to publish via LinkedIn (using image if attached and present)
    let publishResult: PublishResult;
    const hasValidImage = draft.imagePath && typeof draft.imagePath === "string" && existsSync(draft.imagePath);

    if (hasValidImage) {
      publishResult = await this.publisher.publishImage({
        text: draft.text,
        imagePath: draft.imagePath!,
      });
    } else {
      publishResult = await this.publisher.publishText({ text: draft.text });
    }

    if (!publishResult.success) {
      return {
        success: false,
        alreadyPublished: false,
        publishResult,
        error: publishResult.error ?? "Unknown publish error",
        contentHash,
        idempotencyKey,
      };
    }

    // 5. Store the published post record
    const now = new Date().toISOString();
    this.storage.insertPublishedPost({
      draftId: draft.id,
      linkedinPostId: publishResult.postId ?? "",
      linkedinPostUrn: publishResult.postUrn ?? "",
      linkedinPostUrl: publishResult.postUrl ?? "",
      contentHash,
      idempotencyKey,
      publishedAt: now,
      createdAt: now,
    });

    // 6. Update draft state to PUBLISHED
    this.storage.updateDraftState(draft.id, "PUBLISHED");

    return {
      success: true,
      alreadyPublished: false,
      publishResult,
      error: undefined,
      contentHash,
      idempotencyKey,
    };
  }

  /**
   * Publish a scheduled post idempotently.
   * Acquires a lock, publishes the linked draft, and releases the lock.
   */
  async publishScheduledPost(scheduled: ScheduledPostRecord): Promise<IdempotentPublishResult> {
    // 1. Acquire publish lock
    const lockId = randomUUID();
    const acquired = this.storage.acquirePublishLock(scheduled.id, lockId, this.lockDurationMs);

    if (acquired === undefined) {
      return {
        success: false,
        alreadyPublished: false,
        publishResult: undefined,
        error: "Could not acquire publish lock — another process may be publishing",
        contentHash: "",
      };
    }

    try {
      // 2. Get the linked draft
      const draft = this.storage.getDraft(scheduled.draftId);
      if (draft === undefined) {
        this.storage.updateScheduledPostState(scheduled.id, "FAILED");
        this.storage.updateScheduledPostAttempt(scheduled.id, (scheduled.attempts ?? 0) + 1, `Draft #${scheduled.draftId} not found`);
        return {
          success: false,
          alreadyPublished: false,
          publishResult: undefined,
          error: `Draft #${scheduled.draftId} not found`,
          contentHash: "",
        };
      }

      // 3. Update scheduled post state to PROCESSING
      this.storage.updateScheduledPostState(scheduled.id, "PROCESSING");

      // 4. Publish the draft
      const result = await this.publishDraft(draft);

      if (result.success) {
        this.storage.updateScheduledPostState(scheduled.id, "PUBLISHED");
      } else {
        this.storage.updateScheduledPostState(scheduled.id, "FAILED");
        this.storage.updateScheduledPostAttempt(scheduled.id, (scheduled.attempts ?? 0) + 1, result.error);
      }

      return result;
    } finally {
      // 5. Always release the lock
      this.storage.releasePublishLock(scheduled.id, lockId);
    }
  }

  /**
   * Prepare a candidate for publishing by normalizing content and checking source IDs.
   */
  prepareCandidate(candidate: ContentCandidateRecord): ContentCandidateRecord | undefined {
    const contentHash = generateCandidateHash(candidate.repo, candidate.source, candidate.title, candidate.facts);

    if (this.storage.candidateExistsByHash(contentHash)) {
      return undefined;
    }

    for (const commitSha of candidate.supportingCommits) {
      if (this.storage.sourceIdExists(commitSha)) {
        return undefined;
      }
    }

    if (candidate.source === "release") {
      if (this.storage.sourceIdExists(`release-${candidate.id}`)) {
        return undefined;
      }
    }

    if (candidate.source === "pull-request") {
      if (this.storage.sourceIdExists(`pr-${candidate.id}`)) {
        return undefined;
      }
    }

    for (const commitSha of candidate.supportingCommits) {
      this.storage.recordSourceId(commitSha);
    }
    if (candidate.source === "release") {
      this.storage.recordSourceId(`release-${candidate.id}`);
    }
    if (candidate.source === "pull-request") {
      this.storage.recordSourceId(`pr-${candidate.id}`);
    }

    return { ...candidate, contentHash };
  }

  /**
   * Check if LinkedIn returned a state that indicates the request may have succeeded.
   */
  isAmbiguousResult(result: PublishResult): boolean {
    if (result.success) return false;

    const error = result.error ?? "";
    if (error.includes("409") || error.includes("Conflict")) {
      return true;
    }
    if (error.includes("timeout") || error.includes("ETIMEDOUT") || error.includes("ECONNRESET")) {
      return true;
    }
    return false;
  }
}
