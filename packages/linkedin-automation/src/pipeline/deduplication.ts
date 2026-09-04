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
 * Uses both source ID matching and real semantic text similarity:
 * - Token n-gram Jaccard similarity
 * - Opening hook / first sentence similarity
 * - Technical keyword overlap
 */

import type { ContentCandidate } from "../sources/github/repository-analyzer.js";

/**
 * Deduplication store for tracking seen sources and content.
 */
export interface DeduplicationStore {
  /** Set of seen source IDs (commit SHAs, release tags, PR numbers). */
  seenSourceIds: Set<string>;
  /** Set of normalized content hashes. */
  seenContentHashes: Set<string>;
  /** Full text of previously accepted drafts for semantic comparison. */
  seenTexts: string[];
}

/**
 * Create a new empty deduplication store.
 */
export function createDeduplicationStore(): DeduplicationStore {
  return {
    seenSourceIds: new Set(),
    seenContentHashes: new Set(),
    seenTexts: [],
  };
}

/**
 * Options for similarity checking.
 */
export interface SimilarityOptions {
  /** Threshold for n-gram text similarity (0.0 to 1.0, default: 0.70). */
  textSimilarityThreshold?: number;
  /** Threshold for opening sentence similarity (0.0 to 1.0, default: 0.80). */
  openingSentenceThreshold?: number;
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
 * Computes exact hash equality, token n-gram Jaccard similarity,
 * and opening sentence matching.
 */
export function isDuplicateDraft(
  text: string,
  store: DeduplicationStore,
  options?: SimilarityOptions,
): { isDuplicate: boolean; reason: string; similarityScore?: number } {
  const textThreshold = options?.textSimilarityThreshold ?? 0.75;
  const hookThreshold = options?.openingSentenceThreshold ?? 0.80;

  const hash = normalizeAndHash(text);
  if (store.seenContentHashes.has(hash)) {
    return { isDuplicate: true, reason: "Identical draft already exists", similarityScore: 1.0 };
  }

  const normalized = normalizeText(text);
  const opening = normalizeText(extractOpeningSentence(text));

  // Compare against full previously seen texts
  for (const seen of store.seenTexts) {
    const seenNorm = normalizeText(seen);
    const sim = calculateTokenNgramSimilarity(normalized, seenNorm);

    if (sim >= textThreshold) {
      return {
        isDuplicate: true,
        reason: `Draft is ${Math.round(sim * 100)}% similar to an existing post`,
        similarityScore: sim,
      };
    }

    // Check opening sentence overlap
    const seenOpening = normalizeText(extractOpeningSentence(seen));
    if (opening && seenOpening && opening.length > 15) {
      const hookSim = calculateTokenNgramSimilarity(opening, seenOpening);
      if (hookSim >= hookThreshold) {
        return {
          isDuplicate: true,
          reason: `Draft opening hook is ${Math.round(hookSim * 100)}% similar to an existing post`,
          similarityScore: hookSim,
        };
      }
    }
  }

  return { isDuplicate: false, reason: "", similarityScore: 0 };
}

/**
 * Mark a draft as seen.
 */
export function markDraftAsSeen(text: string, store: DeduplicationStore): void {
  const hash = normalizeAndHash(text);
  store.seenContentHashes.add(hash);
  if (!store.seenTexts) store.seenTexts = [];
  store.seenTexts.push(text);
}

/**
 * Normalize text into lower-case clean alphanumeric words.
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract the first sentence from text.
 */
export function extractOpeningSentence(text: string): string {
  const parts = text.split(/[.!?\n]/);
  return (parts[0] ?? "").trim();
}

/**
 * Calculate Jaccard similarity over word 1-grams and 2-grams.
 */
export function calculateTokenNgramSimilarity(textA: string, textB: string): number {
  if (textA === textB) return 1.0;
  if (!textA || !textB) return 0.0;

  const wordsA = textA.split(" ").filter(Boolean);
  const wordsB = textB.split(" ").filter(Boolean);

  if (wordsA.length === 0 || wordsB.length === 0) return 0.0;

  const ngramsA = extractNgrams(wordsA);
  const ngramsB = extractNgrams(wordsB);

  const intersection = new Set([...ngramsA].filter((x) => ngramsB.has(x)));
  const union = new Set([...ngramsA, ...ngramsB]);

  if (union.size === 0) return 0.0;
  return intersection.size / union.size;
}

function extractNgrams(words: string[]): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < words.length; i++) {
    set.add(`1:${words[i]}`);
    if (i < words.length - 1) {
      set.add(`2:${words[i]}_${words[i + 1]}`);
    }
  }
  return set;
}

/**
 * Normalize text and create a simple hash for comparison.
 */
function normalizeAndHash(text: string): string {
  const normalized = normalizeText(text);
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}
