// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Verifies factual claims in a draft post against the original facts.
 *
 * Every claim must be traceable to a source. Unsupported claims
 * are flagged for removal or rewriting.
 */

import type { Fact } from "./fact-extractor.js";

/**
 * Verification status for a claim.
 */
export type ClaimStatus = "SUPPORTED" | "UNCERTAIN" | "UNSUPPORTED";

/**
 * A single verified claim.
 */
export interface VerifiedClaim {
  /** The claim text extracted from the draft. */
  claim: string;
  /** Verification status. */
  status: ClaimStatus;
  /** Matching fact ID (if supported). */
  matchingFactId: string | undefined;
  /** Confidence in the verification. */
  confidence: number;
  /** Human-readable explanation. */
  explanation: string;
}

/**
 * Result of claim verification.
 */
export interface ClaimVerificationResult {
  /** All verified claims. */
  claims: VerifiedClaim[];
  /** Whether all important claims are supported. */
  allSupported: boolean;
  /** Number of unsupported claims. */
  unsupportedCount: number;
  /** Summary. */
  summary: string;
}

/**
 * Extract sentences that make factual claims from text.
 */
function extractClaims(text: string): string[] {
  // Split into sentences
  const sentences = text
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);

  // Filter for claim-like sentences (contain technical assertions)
  return sentences.filter((s) => {
    // Skip hashtags and very short lines
    if (s.startsWith("#") || s.length < 15) return false;
    // Skip lines that are mostly emojis or punctuation
    const alphaRatio = (s.match(/[a-zA-Z]/g) ?? []).length / s.length;
    return alphaRatio > 0.5;
  });
}

/**
 * Check if a claim matches a fact using word overlap.
 */
function matchesFact(claim: string, fact: Fact): { matched: boolean; score: number } {
  const claimWords = new Set(claim.toLowerCase().split(/\s+/));
  const factWords = new Set(fact.claim.toLowerCase().split(/\s+/));

  // Remove common words
  const stopWords = new Set([
    "the",
    "a",
    "an",
    "is",
    "are",
    "was",
    "were",
    "in",
    "on",
    "at",
    "to",
    "for",
    "of",
    "and",
    "or",
    "but",
    "with",
    "by",
    "from",
  ]);
  for (const sw of stopWords) {
    claimWords.delete(sw);
    factWords.delete(sw);
  }

  if (claimWords.size === 0 || factWords.size === 0) {
    return { matched: false, score: 0 };
  }

  const intersection = new Set([...claimWords].filter((w) => factWords.has(w)));
  const union = new Set([...claimWords, ...factWords]);

  const score = intersection.size / union.size;

  // Also check for substring containment
  const claimLower = claim.toLowerCase();
  const factLower = fact.claim.toLowerCase();
  const containsMatch = claimLower.includes(factLower) || factLower.includes(claimLower);

  return {
    matched: score > 0.3 || containsMatch,
    score: containsMatch ? 1.0 : score,
  };
}

/**
 * Verify claims in a draft against the original facts.
 */
export function verifyClaims(draft: string, facts: Fact[]): ClaimVerificationResult {
  const claims = extractClaims(draft);
  const verified: VerifiedClaim[] = [];

  for (const claim of claims) {
    let bestMatch: { factId: string; score: number } | undefined;

    for (const fact of facts) {
      const { matched, score } = matchesFact(claim, fact);
      if (matched && (bestMatch === undefined || score > bestMatch.score)) {
        bestMatch = { factId: fact.id, score };
      }
    }

    if (bestMatch !== undefined && bestMatch.score > 0.5) {
      verified.push({
        claim,
        status: "SUPPORTED",
        matchingFactId: bestMatch.factId,
        confidence: bestMatch.score,
        explanation: `Matches fact ${bestMatch.factId} (score: ${bestMatch.score.toFixed(2)})`,
      });
    } else if (bestMatch !== undefined && bestMatch.score > 0.3) {
      verified.push({
        claim,
        status: "UNCERTAIN",
        matchingFactId: bestMatch.factId,
        confidence: bestMatch.score,
        explanation: `Partial match with fact ${bestMatch.factId} — use conservative wording`,
      });
    } else {
      verified.push({
        claim,
        status: "UNSUPPORTED",
        matchingFactId: undefined,
        confidence: 0,
        explanation: "No matching fact found — this claim may be fabricated",
      });
    }
  }

  const unsupportedCount = verified.filter((c) => c.status === "UNSUPPORTED").length;
  const allSupported = unsupportedCount === 0;

  const summary =
    verified.length === 0
      ? "No claims to verify."
      : `${verified.filter((c) => c.status === "SUPPORTED").length} supported, ` +
        `${verified.filter((c) => c.status === "UNCERTAIN").length} uncertain, ` +
        `${unsupportedCount} unsupported.`;

  return { claims: verified, allSupported, unsupportedCount, summary };
}
