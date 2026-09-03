// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Deduplication for content candidates and drafts.
 *
 * Prevents generating multiple drafts from the same:
 * - Commit
 * - Release
 * - PR
 * - Candidate cluster
 *
 * Uses both source ID matching and content similarity.
 */

import type { ContentCandidate } from "../sources/github/repository-analyzer.js";

/**
 * Deduplication store for tracking seen sources.
 */
export interface DeduplicationStore {
  /** Set of seen source IDs (commit SHAs, release tags, PR numbers). */
  seenSourceIds: Set<string>;
  /** Set of normalized content hashes. */
  seenContentHashes: Set<string>;
}

/**
 * Create a new empty deduplication store.
 */
export function createDeduplicationStore(): DeduplicationStore {
  return {
    seenSourceIds: new Set(),
    seenContentHashes: new Set(),
  };
}

/**
 * Check if a candidate is a duplicate.
 */
export function isDuplicateCandidate(
  candidate: ContentCandidate,
  store: DeduplicationStore,
): { isDuplicate: boolean; reason: string } {
  // Check source IDs
  for (const commitSha of candidate.supportingCommits) {
    if (store.seenSourceIds.has(commitSha)) {
      return { isDuplicate: true, reason: `Commit ${commitSha} already processed` };
    }
  }

  if (candidate.source === "release") {
    const releaseId = `release-${candidate.id}`;
    if (store.seenSourceIds.has(releaseId)) {
      return { isDuplicate: true, reason: `Release ${candidate.id} already processed` };
    }
  }

  if (candidate.source === "pull-request") {
    const prId = `pr-${candidate.id}`;
    if (store.seenSourceIds.has(prId)) {
      return { isDuplicate: true, reason: `PR ${candidate.id} already processed` };
    }
  }

  // Check content similarity
  const contentHash = normalizeAndHash(candidate.title + " " + candidate.facts.join(" "));
  if (store.seenContentHashes.has(contentHash)) {
    return { isDuplicate: true, reason: "Similar content already processed" };
  }

  return { isDuplicate: false, reason: "" };
}

/**
 * Mark a candidate as seen in the deduplication store.
 */
export function markAsSeen(candidate: ContentCandidate, store: DeduplicationStore): void {
  for (const commitSha of candidate.supportingCommits) {
    store.seenSourceIds.add(commitSha);
  }

  if (candidate.source === "release") {
    store.seenSourceIds.add(`release-${candidate.id}`);
  }

  if (candidate.source === "pull-request") {
    store.seenSourceIds.add(`pr-${candidate.id}`);
  }

  const contentHash = normalizeAndHash(candidate.title + " " + candidate.facts.join(" "));
  store.seenContentHashes.add(contentHash);
}

/**
 * Filter out duplicate candidates from a list.
 */
export function filterDuplicates(
  candidates: ContentCandidate[],
  store: DeduplicationStore,
): { unique: ContentCandidate[]; duplicates: ContentCandidate[] } {
  const unique: ContentCandidate[] = [];
  const duplicates: ContentCandidate[] = [];

  for (const candidate of candidates) {
    const { isDuplicate } = isDuplicateCandidate(candidate, store);
    if (isDuplicate) {
      duplicates.push(candidate);
    } else {
      unique.push(candidate);
      markAsSeen(candidate, store);
    }
  }

  return { unique, duplicates };
}

/**
 * Check if a draft text is too similar to previously seen drafts.
 */
export function isDuplicateDraft(text: string, store: DeduplicationStore): { isDuplicate: boolean; reason: string } {
  const hash = normalizeAndHash(text);
  if (store.seenContentHashes.has(hash)) {
    return { isDuplicate: true, reason: "Identical draft already exists" };
  }

  // Check for high similarity with any seen content
  for (const seenHash of store.seenContentHashes) {
    const similarity = hashSimilarity(hash, seenHash);
    if (similarity > 0.8) {
      return { isDuplicate: true, reason: `Draft is ${Math.round(similarity * 100)}% similar to existing content` };
    }
  }

  return { isDuplicate: false, reason: "" };
}

/**
 * Mark a draft as seen.
 */
export function markDraftAsSeen(text: string, store: DeduplicationStore): void {
  const hash = normalizeAndHash(text);
  store.seenContentHashes.add(hash);
}

/**
 * Normalize text and create a simple hash for comparison.
 */
function normalizeAndHash(text: string): string {
  const normalized = text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Simple hash using char codes
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

/**
 * Calculate similarity between two hash strings (as a proxy for content similarity).
 * This is a rough approximation — for production, use proper MinHash or similar.
 */
function hashSimilarity(hashA: string, hashB: string): number {
  // Simple character overlap comparison
  if (hashA === hashB) return 1;
  const setA = new Set(hashA);
  const setB = new Set(hashB);
  const intersection = new Set([...setA].filter((c) => setB.has(c)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}
