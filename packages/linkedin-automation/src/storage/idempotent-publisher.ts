// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Idempotent publisher for LinkedIn posts.
 *
 * Before publishing:
 * 1. Normalize content
 * 2. Generate contentHash
 * 3. Verify source IDs haven't been published before
 * 4. Check previous published posts for duplicates
 * 5. Acquire publishing lock
 * 6. Publish
 * 7. Store LinkedIn post ID/URN
 * 8. Mark PUBLISHED
 *
 * Does NOT blindly retry if LinkedIn returned an unknown network state.
 * Prevents duplicates via content hash and source ID tracking.
 */

import { randomUUID } from "node:crypto";

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
}

/**
 * IdempotentPublisher wraps LinkedIn publishing with deduplication and locking.
 *
 * It ensures that:
 * - The same content is never published twice
 * - Publishing is atomic (lock → publish → store → unlock)
 * - Unknown LinkedIn errors are not blindly retried
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
   *
   * Checks all deduplication conditions before publishing.
   * Returns a structured result indicating whether the publish was
   * new, a duplicate, or failed.
   */
  async publishDraft(draft: PostDraftRecord): Promise<IdempotentPublishResult> {
    // 1. Normalize content and generate hash
    const contentHash = generateContentHash(draft.text);

    // 2. Check if this content hash was already published
    if (this.storage.publishedPostExistsByHash(contentHash)) {
      return {
        success: true,
        alreadyPublished: true,
        publishResult: undefined,
        error: undefined,
        contentHash,
      };
    }

    // 3. Check if a draft with this hash already exists (prevent duplicate drafts)
    if (draft.id !== 0 && this.storage.draftExistsByHash(contentHash)) {
      // Only flag as duplicate if it's a different draft record
      const existing = this.storage.getAllDrafts().find((d) => d.contentHash === contentHash);
      if (existing !== undefined && existing.id !== draft.id) {
        return {
          success: false,
          alreadyPublished: false,
          publishResult: undefined,
          error: `Draft with identical content already exists (draft #${existing.id})`,
          contentHash,
        };
      }
    }

    // 4. Try to publish via LinkedIn
    const publishResult = await this.publisher.publishText({ text: draft.text });

    if (!publishResult.success) {
      return {
        success: false,
        alreadyPublished: false,
        publishResult,
        error: publishResult.error ?? "Unknown publish error",
        contentHash,
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
    };
  }

  /**
   * Publish a scheduled post idempotently.
   *
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
      }

      return result;
    } finally {
      // 5. Always release the lock
      this.storage.releasePublishLock(scheduled.id, lockId);
    }
  }

  /**
   * Prepare a candidate for publishing by normalizing content and checking
   * source IDs.
   *
   * Returns the candidate with contentHash populated, or undefined if
   * the candidate should be skipped (duplicate).
   */
  prepareCandidate(candidate: ContentCandidateRecord): ContentCandidateRecord | undefined {
    // Generate content hash from candidate fields
    const contentHash = generateCandidateHash(candidate.repo, candidate.source, candidate.title, candidate.facts);

    // Check if this candidate's content hash already exists
    if (this.storage.candidateExistsByHash(contentHash)) {
      return undefined;
    }

    // Check if any source IDs have been seen
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

    // Record all source IDs
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
   * Check if LinkedIn returned a state that indicates the request
   * may have succeeded (unknown network state).
   *
   * In this case, we should NOT blindly retry — the post might
   * have been published.
   */
  isAmbiguousResult(result: PublishResult): boolean {
    if (result.success) return false;

    const error = result.error ?? "";
    // LinkedIn sometimes returns 409 Conflict when a duplicate post is attempted
    if (error.includes("409") || error.includes("Conflict")) {
      return true;
    }
    // Network timeout might have succeeded server-side
    if (error.includes("timeout") || error.includes("ETIMEDOUT")) {
      return true;
    }
    return false;
  }
}
