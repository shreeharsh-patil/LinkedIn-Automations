// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Content normalization and hashing for idempotent publishing.
 *
 * Before publishing, the post text is normalized and hashed to:
 * 1. Prevent duplicate posts from identical content
 * 2. Enable deduplication across restarts
 * 3. Provide a stable key for the storage layer
 *
 * Normalization is deterministic: the same content always produces
 * the same hash, regardless of minor whitespace differences.
 */

import { createHash } from "node:crypto";

/**
 * Normalize post text for consistent hashing.
 *
 * Steps:
 * 1. Trim leading/trailing whitespace
 * 2. Collapse multiple whitespace characters into single spaces
 * 3. Normalize line endings to \n
 * 4. Remove zero-width characters
 * 5. Normalize hashtag spacing (ensure space before #)
 * 6. Lowercase the text
 */
export function normalizeContent(text: string): string {
  return (
    text
      .trim()
      // Normalize line endings
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      // Remove zero-width characters
      .replace(/\u200B|\u200C|\u200D|\uFEFF/g, "")
      // Normalize multiple whitespace to single space (preserving newlines)
      .replace(/[^\S\n]+/g, " ")
      // Collapse multiple newlines
      .replace(/\n{3,}/g, "\n\n")
      // Ensure space before hashtags (but not at start of line)
      .replace(/([^\s])#/g, "$1 #")
      // Collapse multiple spaces again after hashtag fix
      .replace(/  +/g, " ")
      .toLowerCase()
      .trim()
  );
}

/**
 * Generate a SHA-256 content hash from normalized text.
 *
 * Returns a hex-encoded string (64 characters).
 */
export function generateContentHash(text: string): string {
  const normalized = normalizeContent(text);
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

/**
 * Generate a content hash from a candidate's key fields.
 *
 * This produces a stable hash that covers:
 * - Repository
 * - Source type
 * - Title
 * - All facts (joined)
 */
export function generateCandidateHash(repo: string, source: string, title: string, facts: string[]): string {
  const payload = [
    repo.toLowerCase().trim(),
    source.toLowerCase().trim(),
    title.toLowerCase().trim(),
    ...facts.map((f) => f.toLowerCase().trim()),
  ].join("\n");

  return createHash("sha256").update(payload, "utf8").digest("hex");
}

/**
 * Compute a similarity score between two content hashes.
 *
 * Uses Hamming distance on the hex characters as a fast approximation.
 * Returns a value between 0 (identical) and 1 (completely different).
 *
 * Note: This is for informational purposes. The primary dedup mechanism
 * is exact hash matching, not similarity.
 */
export function hashDistance(hashA: string, hashB: string): number {
  if (hashA.length !== hashB.length) return 1;

  let differences = 0;
  for (let i = 0; i < hashA.length; i++) {
    if ((hashA[i] ?? "") !== (hashB[i] ?? "")) {
      differences++;
    }
  }
  return differences / hashA.length;
}
