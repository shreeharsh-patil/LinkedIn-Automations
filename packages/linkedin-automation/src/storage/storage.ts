// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Storage port (interface) for persistent post state.
 *
 * All methods are transactional within a single call.
 * Implementations must be safe for single-process access.
 *
 * A PostgreSQL implementation can be added later by implementing
 * this interface — the SQLite implementation is for local development.
 */

import type {
  ContentCandidateRecord,
  PostDraftRecord,
  PostState,
  PublishedPostRecord,
  ScheduledPostRecord,
  AutomationSettingsRecord,
} from "./types.js";

/**
 * Storage port for persistent post state.
 */
export interface StoragePort {
  /** Initialize the database schema (idempotent). */
  initialize(): void;

  /** Close the database connection. */
  close(): void;

  // ─── Content Candidates ──────────────────────────────────────

  /** Insert a new content candidate. */
  insertCandidate(candidate: ContentCandidateRecord): void;

  /** Get a content candidate by ID. */
  getCandidate(id: string): ContentCandidateRecord | undefined;

  /** Update the state of a content candidate. */
  updateCandidateState(id: string, state: PostState): void;

  /** Get all candidates in a given state. */
  getCandidatesByState(state: PostState): ContentCandidateRecord[];

  /** Get all candidates. */
  getAllCandidates(): ContentCandidateRecord[];

  /** Check if a content hash already exists among candidates. */
  candidateExistsByHash(contentHash: string): boolean;

  /** Check if any source ID is already tracked. */
  sourceIdExists(sourceId: string): boolean;

  /** Record a source ID as seen (for deduplication). */
  recordSourceId(sourceId: string): void;

  // ─── Post Drafts ─────────────────────────────────────────────

  /** Insert a new post draft. Returns the auto-generated ID. */
  insertDraft(draft: Omit<PostDraftRecord, "id">): number;

  /** Get a draft by ID. */
  getDraft(id: number): PostDraftRecord | undefined;

  /** Update the state of a draft. */
  updateDraftState(id: number, state: PostState): void;

  /** Update draft text, word count, and content hash. */
  updateDraftText(id: number, text: string, wordCount: number, contentHash: string): void;

  /** Update draft media attachments. */
  updateDraftMedia(id: number, imagePath?: string, mediaUrn?: string): void;

  /** Get all drafts in a given state. */
  getDraftsByState(state: PostState): PostDraftRecord[];

  /** Get all drafts. */
  getAllDrafts(): PostDraftRecord[];

  /** Check if a draft with the given content hash already exists. */
  draftExistsByHash(contentHash: string): boolean;

  // ─── Scheduled Posts ─────────────────────────────────────────

  /** Insert a scheduled post. Returns the auto-generated ID. */
  insertScheduledPost(post: Omit<ScheduledPostRecord, "id" | "attempts"> & { attempts?: number }): number;

  /** Get a scheduled post by ID. */
  getScheduledPost(id: number): ScheduledPostRecord | undefined;

  /** Update the state of a scheduled post. */
  updateScheduledPostState(id: number, state: PostState): void;

  /** Update attempt count and last error message for a scheduled post. */
  updateScheduledPostAttempt(id: number, attempts: number, lastError?: string): void;

  /** Acquire a publishing lock on a scheduled post. Returns the lock ID or undefined if already locked. */
  acquirePublishLock(id: number, lockId: string, lockDurationMs: number): string | undefined;

  /** Release a publishing lock on a scheduled post. */
  releasePublishLock(id: number, lockId: string): void;

  /** Get the next scheduled post that is ready for processing (SCHEDULED state, not locked, scheduledAt <= now). */
  getNextScheduledPost(): ScheduledPostRecord | undefined;

  /** Atomically claim and lock the next due scheduled post (prevents race conditions between workers). */
  claimNextScheduledPost(lockId: string, lockDurationMs: number): ScheduledPostRecord | undefined;

  // ─── Published Posts ─────────────────────────────────────────

  /** Insert a published post record. */
  insertPublishedPost(post: Omit<PublishedPostRecord, "id">): number;

  /** Get all published posts. */
  getAllPublishedPosts(): PublishedPostRecord[];

  /** Check if a post with the given content hash has already been published. */
  publishedPostExistsByHash(contentHash: string): boolean;

  /** Check if a post with the given idempotency key has already been published. */
  publishedPostExistsByIdempotencyKey(key: string): boolean;

  /** Get a published post by LinkedIn post URN. */
  getPublishedPostByUrn(urn: string): PublishedPostRecord | undefined;

  // ─── Automation Settings ─────────────────────────────────────

  /** Get automation settings (creates defaults if not exists). */
  getSettings(): AutomationSettingsRecord;

  /** Update automation settings. */
  updateSettings(settings: Omit<AutomationSettingsRecord, "id" | "updatedAt">): void;
}
