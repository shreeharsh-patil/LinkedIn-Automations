// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Final quality review for LinkedIn posts.
 *
 * Combines slop guard, claim verification, and additional quality checks
 * to produce a final approval/rejection decision.
 */

import type { SlopGuardResult } from "./slop-guard.js";
import type { ClaimVerificationResult } from "./claim-verifier.js";

/**
 * Review decision.
 */
export type ReviewDecision = "APPROVED" | "REVISION_REQUIRED" | "REJECTED";

/**
 * Result of the review.
 */
export interface ReviewResult {
  /** The review decision. */
  decision: ReviewDecision;
  /** Combined score (0-100, higher is better). */
  score: number;
  /** Issues that must be fixed. */
  issues: string[];
  /** Suggestions for improvement. */
  suggestions: string[];
  /** Human-readable summary. */
  summary: string;
}

/**
 * Review a draft post.
 */
export function reviewDraft(
  text: string,
  slopResult: SlopGuardResult,
  claimResult: ClaimVerificationResult,
): ReviewResult {
  const issues: string[] = [];
  const suggestions: string[] = [];
  let score = 100;

  // Check slop guard
  if (!slopResult.passed) {
    issues.push("Post contains AI slop phrases that must be removed");
    score -= slopResult.score;
    for (const v of slopResult.violations.filter((v) => v.severity === "critical")) {
      suggestions.push(`Remove "${v.phrase}" — ${v.suggestion}`);
    }
  }

  // Check claim verification
  if (!claimResult.allSupported) {
    issues.push(`Post has ${claimResult.unsupportedCount} unsupported claim(s)`);
    score -= claimResult.unsupportedCount * 20;
    suggestions.push("Remove or rewrite unsupported claims with conservative wording");
  }

  // Word count check
  const wordCount = text.split(/\s+/).length;
  if (wordCount < 50) {
    issues.push("Post is too short (under 50 words)");
    score -= 20;
  } else if (wordCount > 300) {
    suggestions.push("Consider shortening the post (over 300 words)");
    score -= 5;
  }

  // Hashtag check
  const hashtagCount = (text.match(/#\w+/g) ?? []).length;
  if (hashtagCount > 5) {
    suggestions.push("Too many hashtags — use 0-3");
    score -= 10;
  }

  // Emoji check
  const emojiCount = (text.match(/\p{Emoji_Presentation}/gu) ?? []).length;
  if (emojiCount > 3) {
    suggestions.push("Too many emojis — reduce for technical audience");
    score -= 5;
  }

  // Clamp score
  score = Math.max(0, Math.min(100, score));

  // Decision
  let decision: ReviewDecision;
  if (issues.length === 0 && score >= 80) {
    decision = "APPROVED";
  } else if (score >= 50) {
    decision = "REVISION_REQUIRED";
  } else {
    decision = "REJECTED";
  }

  const summary =
    decision === "APPROVED"
      ? "Post passed all quality checks."
      : decision === "REVISION_REQUIRED"
        ? `Post needs revision: ${issues.join("; ")}`
        : `Post rejected: ${issues.join("; ")}`;

  return { decision, score, issues, suggestions, summary };
}
