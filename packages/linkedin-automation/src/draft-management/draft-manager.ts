// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Draft management operations for safe mode.
 *
 * Provides functions to list, view, approve, edit, reject, and publish drafts.
 * All operations persist state changes to storage.
 */

import type { StoragePort } from "../storage/storage.js";
import type { PostDraftRecord, PostState } from "../storage/types.js";
import { generateContentHash } from "../storage/content-hash.js";

/**
 * Summary item for draft listing.
 */
export interface DraftListItem {
  /** Draft ID. */
  id: number;
  /** Candidate ID. */
  candidateId: string;
  /** First 80 chars of draft text. */
  preview: string;
  /** Word count. */
  wordCount: number;
  /** Current state. */
  state: PostState;
  /** Review score (0-100). */
  reviewScore: number;
  /** Creation timestamp. */
  createdAt: string;
}

/**
 * Full draft details for viewing.
 */
export interface DraftViewDetails {
  /** The complete draft record. */
  draft: PostDraftRecord;
  /** The candidate record (if available). */
  candidateTitle: string | undefined;
  /** Candidate repo. */
  candidateRepo: string | undefined;
}

/**
 * Result of a draft action (approve, edit, reject, publish).
 */
export interface DraftActionResult {
  /** Whether the action succeeded. */
  success: boolean;
  /** The draft ID. */
  draftId: number;
  /** New state of the draft. */
  newState: PostState;
  /** Human-readable message. */
  message: string;
  /** LinkedIn post URL (only for postNow). */
  postUrl: string | undefined;
  /** LinkedIn post URN (only for postNow). */
  postUrn: string | undefined;
}

/**
 * List all drafts with summary information.
 *
 * @param storage - Storage port.
 * @param filterState - Optional state filter.
 * @returns Array of draft list items.
 */
export function listDrafts(storage: StoragePort, filterState?: PostState): DraftListItem[] {
  const drafts = filterState !== undefined ? storage.getDraftsByState(filterState) : storage.getAllDrafts();

  return drafts.map((draft) => ({
    id: draft.id,
    candidateId: draft.candidateId,
    preview: draft.text.length > 80 ? draft.text.slice(0, 77) + "..." : draft.text,
    wordCount: draft.wordCount,
    state: draft.state,
    reviewScore: draft.reviewScore,
    createdAt: draft.createdAt,
  }));
}

/**
 * View full details of a single draft.
 *
 * @param storage - Storage port.
 * @param draftId - The draft ID to view.
 * @returns Draft details, or undefined if not found.
 */
export function viewDraft(storage: StoragePort, draftId: number): DraftViewDetails | undefined {
  const draft = storage.getDraft(draftId);
  if (draft === undefined) {
    return undefined;
  }

  // Try to get the candidate for context
  const candidate = storage.getCandidate(draft.candidateId);

  return {
    draft,
    candidateTitle: candidate?.title,
    candidateRepo: candidate?.repo,
  };
}

/**
 * Approve a draft for publishing.
 *
 * Transitions: REVIEW_REQUIRED → APPROVED
 *
 * @param storage - Storage port.
 * @param draftId - The draft ID to approve.
 * @returns Action result.
 */
export function approveDraft(storage: StoragePort, draftId: number): DraftActionResult {
  const draft = storage.getDraft(draftId);
  if (draft === undefined) {
    return {
      success: false,
      draftId,
      newState: "DRAFT" as PostState,
      message: `Draft #${draftId} not found.`,
      postUrl: undefined,
      postUrn: undefined,
    };
  }

  if (draft.state !== "REVIEW_REQUIRED") {
    return {
      success: false,
      draftId,
      newState: draft.state,
      message: `Draft #${draftId} is in ${draft.state} state. Only drafts in REVIEW_REQUIRED can be approved.`,
      postUrl: undefined,
      postUrn: undefined,
    };
  }

  storage.updateDraftState(draftId, "APPROVED");

  return {
    success: true,
    draftId,
    newState: "APPROVED",
    message: `Draft #${draftId} approved for publishing.`,
    postUrl: undefined,
    postUrn: undefined,
  };
}

/**
 * Edit a draft's text content.
 *
 * Updates the text, word count, and content hash.
 * Transitions back to REVIEW_REQUIRED for re-review.
 *
 * @param storage - Storage port.
 * @param draftId - The draft ID to edit.
 * @param newText - The new text content.
 * @returns Action result.
 */
export function editDraft(storage: StoragePort, draftId: number, newText: string): DraftActionResult {
  const draft = storage.getDraft(draftId);
  if (draft === undefined) {
    return {
      success: false,
      draftId,
      newState: "DRAFT" as PostState,
      message: `Draft #${draftId} not found.`,
      postUrl: undefined,
      postUrn: undefined,
    };
  }

  if (newText.trim() === "") {
    return {
      success: false,
      draftId,
      newState: draft.state,
      message: "Draft text cannot be empty.",
      postUrl: undefined,
      postUrn: undefined,
    };
  }

  // Update the draft text and content hash
  const wordCount = newText.split(/\s+/).length;
  const contentHash = generateContentHash(newText);

  storage.updateDraftText(draftId, newText, wordCount, contentHash);

  return {
    success: true,
    draftId,
    newState: "REVIEW_REQUIRED",
    message: `Draft #${draftId} updated and returned to REVIEW_REQUIRED.`,
    postUrl: undefined,
    postUrn: undefined,
  };
}

/**
 * Reject a draft (skip it).
 *
 * Transitions: REVIEW_REQUIRED or APPROVED → SKIPPED
 *
 * @param storage - Storage port.
 * @param draftId - The draft ID to reject.
 * @returns Action result.
 */
export function rejectDraft(storage: StoragePort, draftId: number): DraftActionResult {
  const draft = storage.getDraft(draftId);
  if (draft === undefined) {
    return {
      success: false,
      draftId,
      newState: "DRAFT" as PostState,
      message: `Draft #${draftId} not found.`,
      postUrl: undefined,
      postUrn: undefined,
    };
  }

  if (draft.state !== "REVIEW_REQUIRED" && draft.state !== "APPROVED") {
    return {
      success: false,
      draftId,
      newState: draft.state,
      message: `Draft #${draftId} is in ${draft.state} state. Only REVIEW_REQUIRED or APPROVED drafts can be rejected.`,
      postUrl: undefined,
      postUrn: undefined,
    };
  }

  storage.updateDraftState(draftId, "SKIPPED");

  return {
    success: true,
    draftId,
    newState: "SKIPPED",
    message: `Draft #${draftId} rejected (skipped).`,
    postUrl: undefined,
    postUrn: undefined,
  };
}

/**
 * Publish a draft immediately.
 *
 * Requires the draft to be in APPROVED state.
 * Creates a scheduled post with immediate publish time.
 *
 * @param storage - Storage port.
 * @param draftId - The draft ID to publish.
 * @returns Action result.
 */
export function postNow(storage: StoragePort, draftId: number): DraftActionResult {
  const draft = storage.getDraft(draftId);
  if (draft === undefined) {
    return {
      success: false,
      draftId,
      newState: "DRAFT" as PostState,
      message: `Draft #${draftId} not found.`,
      postUrl: undefined,
      postUrn: undefined,
    };
  }

  if (draft.state !== "APPROVED") {
    return {
      success: false,
      draftId,
      newState: draft.state,
      message: `Draft #${draftId} is in ${draft.state} state. Only APPROVED drafts can be posted immediately.`,
      postUrl: undefined,
      postUrn: undefined,
    };
  }

  // Create a scheduled post with immediate time
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

  // Update draft state
  storage.updateDraftState(draftId, "SCHEDULED");

  return {
    success: true,
    draftId,
    newState: "SCHEDULED",
    message: `Draft #${draftId} queued for immediate publishing.`,
    postUrl: undefined,
    postUrn: undefined,
  };
}
