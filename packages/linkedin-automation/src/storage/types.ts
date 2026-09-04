// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Post lifecycle states.
 *
 * Full lifecycle covers:
 * DISCOVERED → ANALYZING → GENERATED → VALIDATED → DRAFT → REVIEW_REQUIRED → APPROVED
 * → QUEUED / SCHEDULED → PUBLISHING / PROCESSING → PUBLISHED (or FAILED/CANCELLED/SKIPPED).
 */
export type PostState =
  | "DISCOVERED"
  | "ANALYZING"
  | "GENERATED"
  | "VALIDATED"
  | "DRAFT"
  | "REVIEW_REQUIRED"
  | "APPROVED"
  | "QUEUED"
  | "SCHEDULED"
  | "PUBLISHING"
  | "PROCESSING"
  | "PUBLISHED"
  | "FAILED"
  | "CANCELLED"
  | "SKIPPED";

/**
 * All possible states as a const array for iteration.
 */
export const POST_STATES: readonly PostState[] = [
  "DISCOVERED",
  "ANALYZING",
  "GENERATED",
  "VALIDATED",
  "DRAFT",
  "REVIEW_REQUIRED",
  "APPROVED",
  "QUEUED",
  "SCHEDULED",
  "PUBLISHING",
  "PROCESSING",
  "PUBLISHED",
  "FAILED",
  "CANCELLED",
  "SKIPPED",
] as const;

/**
 * Valid state transitions.
 */
export const VALID_TRANSITIONS: ReadonlyMap<PostState, readonly PostState[]> = new Map([
  ["DISCOVERED", ["ANALYZING", "GENERATED", "SKIPPED"]],
  ["ANALYZING", ["GENERATED", "DRAFT", "SKIPPED", "FAILED"]],
  ["GENERATED", ["VALIDATED", "DRAFT", "FAILED", "SKIPPED"]],
  ["VALIDATED", ["DRAFT", "REVIEW_REQUIRED", "APPROVED", "FAILED", "SKIPPED"]],
  ["DRAFT", ["VALIDATED", "REVIEW_REQUIRED", "APPROVED", "QUEUED", "SCHEDULED", "SKIPPED", "CANCELLED"]],
  ["REVIEW_REQUIRED", ["APPROVED", "DRAFT", "SKIPPED", "FAILED", "CANCELLED"]],
  ["APPROVED", ["QUEUED", "SCHEDULED", "PUBLISHING", "PROCESSING", "SKIPPED", "CANCELLED"]],
  ["QUEUED", ["PUBLISHING", "PROCESSING", "FAILED", "CANCELLED"]],
  ["SCHEDULED", ["QUEUED", "PUBLISHING", "PROCESSING", "FAILED", "CANCELLED"]],
  ["PUBLISHING", ["PUBLISHED", "FAILED", "SCHEDULED"]],
  ["PROCESSING", ["PUBLISHED", "FAILED", "SCHEDULED"]],
  ["PUBLISHED", []],
  ["FAILED", []],
  ["CANCELLED", []],
  ["SKIPPED", []],
]);

/**
 * Check whether a state transition is valid.
 */
export function isValidTransition(from: PostState, to: PostState): boolean {
  const allowed = VALID_TRANSITIONS.get(from);
  return allowed !== undefined && allowed.includes(to);
}

/**
 * A content candidate discovered from a source (e.g. GitHub).
 */
export interface ContentCandidateRecord {
  /** Unique identifier. */
  id: string;
  /** Repository (owner/repo). */
  repo: string;
  /** Source type. */
  source: "commits" | "release" | "pull-request" | "issue";
  /** Numeric score. */
  score: number;
  /** Title for the candidate. */
  title: string;
  /** Technical facts extracted from the source (JSON array). */
  facts: string[];
  /** Why this qualifies as a post. */
  reason: string;
  /** Supporting commit SHAs (JSON array). */
  supportingCommits: string[];
  /** Supporting file paths (JSON array). */
  supportingFiles: string[];
  /** Current lifecycle state. */
  state: PostState;
  /** Content hash for deduplication. */
  contentHash: string;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /** ISO-8601 last-update timestamp. */
  updatedAt: string;
}

/**
 * A post draft generated from a content candidate.
 */
export interface PostDraftRecord {
  /** Auto-increment primary key. */
  id: number;
  /** Reference to the content candidate. */
  candidateId: string;
  /** The generated post text. */
  text: string;
  /** Word count. */
  wordCount: number;
  /** IDs of facts used (JSON array). */
  factsUsed: string[];
  /** Slop guard score (0-100, lower is better). */
  slopScore: number;
  /** Claim verification summary. */
  verificationSummary: string;
  /** Review decision. */
  reviewDecision: string;
  /** Review score (0-100). */
  reviewScore: number;
  /** Review suggestions (JSON array). */
  suggestions: string[];
  /** Path to local image/visual attachment if any. */
  imagePath?: string | undefined;
  /** LinkedIn media URN if already uploaded. */
  mediaUrn?: string | undefined;
  /** Current lifecycle state. */
  state: PostState;
  /** Content hash for idempotency. */
  contentHash: string;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /** ISO-8601 last-update timestamp. */
  updatedAt: string;
}

/**
 * A scheduled post waiting to be published.
 */
export interface ScheduledPostRecord {
  /** Auto-increment primary key. */
  id: number;
  /** Reference to the post draft. */
  draftId: number;
  /** ISO-8601 scheduled publish time (always stored in UTC). */
  scheduledAt: string;
  /** Publishing lock identifier (UUID). */
  lockId: string | undefined;
  /** ISO-8601 lock expiry time. */
  lockExpiresAt: string | undefined;
  /** Current lifecycle state. */
  state: PostState;
  /** Retry attempt counter. */
  attempts: number;
  /** Last error message if failed. */
  lastError?: string | undefined;
  /** Deterministic idempotency key for this scheduled post. */
  idempotencyKey?: string | undefined;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /** ISO-8601 last-update timestamp. */
  updatedAt: string;
}

/**
 * A post that has been published to LinkedIn.
 */
export interface PublishedPostRecord {
  /** Auto-increment primary key. */
  id: number;
  /** Reference to the post draft. */
  draftId: number;
  /** LinkedIn post ID (numeric share ID). */
  linkedinPostId: string;
  /** LinkedIn post URN (e.g. `urn:li:share:123`). */
  linkedinPostUrn: string;
  /** Public URL to the published post. */
  linkedinPostUrl: string;
  /** Content hash of the published text (for duplicate detection). */
  contentHash: string;
  /** Deterministic idempotency key. */
  idempotencyKey?: string | undefined;
  /** ISO-8601 publish timestamp. */
  publishedAt: string;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
}

/**
 * Automation settings (singleton row).
 */
export interface AutomationSettingsRecord {
  /** Always 1 (singleton). */
  id: number;
  /** Default lookback period in days. */
  lookbackDays: number;
  /** Score threshold for content candidates. */
  scoreThreshold: number;
  /** Maximum words per draft. */
  maxWords: number;
  /** Whether to include hashtags. */
  includeHashtags: boolean;
  /** Minimum interval between posts in milliseconds. */
  minPostIntervalMs: number;
  /** Automation mode ("safe", "semi", "full"). */
  automationMode: string;
  /** Approval window in hours for semi-auto mode. */
  approvalWindowHours: number;
  /** ISO-8601 last-update timestamp. */
  updatedAt: string;
}

/**
 * Default automation settings.
 */
export const DEFAULT_SETTINGS: Omit<AutomationSettingsRecord, "id" | "updatedAt"> = {
  lookbackDays: 7,
  scoreThreshold: 5,
  maxWords: 300,
  includeHashtags: true,
  minPostIntervalMs: 60 * 60 * 1000, // 1 hour
  automationMode: "safe",
  approvalWindowHours: 24,
};
