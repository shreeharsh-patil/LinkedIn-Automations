// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Content generation pipeline.
 *
 * Chains: context → facts → draft → slop check → claim verification → review
 */

import { extractFacts } from "./fact-extractor.js";
import type { Fact } from "./fact-extractor.js";
import { writeDraft } from "./writer.js";
import type { DraftResult } from "./writer.js";
import { detectSlop } from "./slop-guard.js";
import type { SlopGuardResult } from "./slop-guard.js";
import { verifyClaims } from "./claim-verifier.js";
import type { ClaimVerificationResult } from "./claim-verifier.js";
import { reviewDraft } from "./reviewer.js";
import type { ReviewResult } from "./reviewer.js";

/**
 * Full pipeline result.
 */
export interface PipelineResult {
  /** Extracted facts. */
  facts: Fact[];
  /** Generated draft. */
  draft: DraftResult;
  /** Slop guard result. */
  slop: SlopGuardResult;
  /** Claim verification result. */
  claims: ClaimVerificationResult;
  /** Final review. */
  review: ReviewResult;
  /** The final post text (if approved or needs revision). */
  finalPost: string;
  /** Whether the post is ready to publish. */
  readyToPublish: boolean;
}

/**
 * Run the full content generation pipeline.
 *
 * This is a synchronous pipeline — no external API calls.
 * The writer generates text from facts deterministically.
 */
export function runPipeline(
  context: string,
  options?: {
    maxWords?: number | undefined;
    includeHashtags?: boolean | undefined;
  },
): PipelineResult {
  // Step 1: Extract facts
  const { facts } = extractFacts(context);

  // Step 2: Write draft
  const draft = writeDraft(facts, {
    maxWords: options?.maxWords,
    includeHashtags: options?.includeHashtags,
  });

  // Step 3: Slop guard
  const slop = detectSlop(draft.text);

  // Step 4: Claim verification
  const claims = verifyClaims(draft.text, facts);

  // Step 5: Review
  const review = reviewDraft(draft.text, slop, claims);

  // Determine final post
  let finalPost = draft.text;
  if (review.decision === "REJECTED") {
    finalPost = "";
  } else if (review.decision === "REVISION_REQUIRED" && !slop.passed) {
    // Remove slop phrases from the draft
    finalPost = removeSlopPhrases(draft.text, slop);
  }

  const readyToPublish = review.decision === "APPROVED";

  return {
    facts,
    draft,
    slop,
    claims,
    review,
    finalPost,
    readyToPublish,
  };
}

/**
 * Remove detected slop phrases from text.
 */
function removeSlopPhrases(text: string, slop: SlopGuardResult): string {
  let result = text;
  for (const v of slop.violations) {
    const escaped = v.phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result
      .replace(new RegExp(escaped, "gi"), "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }
  return result;
}
