// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Prepare pipeline: discover → analyze → write → verify → present
 *
 * In SAFE mode: produces drafts for human review.
 * In SEMI mode: produces drafts with approval window before publishing.
 * In FULL mode: runs end-to-end with safety checks.
 */

import { analyzeRepository } from "../sources/github/repository-analyzer.js";
import type { ContentCandidate } from "../sources/github/repository-analyzer.js";
import { extractFacts } from "../agents/fact-extractor.js";
import type { Fact } from "../agents/fact-extractor.js";
import { writeDraft } from "../agents/writer.js";
import type { DraftResult } from "../agents/writer.js";
import { detectSlop } from "../agents/slop-guard.js";
import type { SlopGuardResult } from "../agents/slop-guard.js";
import { verifyClaims } from "../agents/claim-verifier.js";
import type { ClaimVerificationResult } from "../agents/claim-verifier.js";
import { reviewDraft } from "../agents/reviewer.js";
import type { ReviewResult } from "../agents/reviewer.js";
import { checkSafety } from "../config/safety-checker.js";
import type { SafetyCheckConfig } from "../config/safety-checker.js";
import { generateCandidateHash } from "../storage/content-hash.js";

/**
 * Status of a prepared draft.
 */
export type DraftStatus = "DISCOVERED" | "ANALYZING" | "DRAFT" | "REVIEW_REQUIRED" | "APPROVED" | "SKIPPED";

/**
 * A prepared draft with full evidence chain.
 */
export interface PreparedDraft {
  /** The original candidate. */
  candidate: ContentCandidate;
  /** Extracted facts with evidence references. */
  facts: Fact[];
  /** Generated draft text. */
  draft: DraftResult;
  /** Slop guard result. */
  slopResult: SlopGuardResult;
  /** Claim verification result. */
  verification: ClaimVerificationResult;
  /** Review result. */
  review: ReviewResult;
  /** Current status. */
  status: DraftStatus;
  /** The final post text. */
  finalPost: string;
}

/**
 * Options for the prepare pipeline.
 */
export interface PrepareOptions {
  /** Lookback period in days (default: 7). */
  lookbackDays?: number | undefined;
  /** Score threshold (default: 5). */
  scoreThreshold?: number | undefined;
  /** Maximum words per draft (default: 300). */
  maxWords?: number | undefined;
  /** Include hashtags (default: true). */
  includeHashtags?: boolean | undefined;
  /** Automation mode (default: "safe"). */
  automationMode?: "safe" | "semi" | "full" | undefined;
  /** Safety check configuration for full-auto mode. */
  safetyConfig?: Partial<SafetyCheckConfig> | undefined;
  /** Set of existing content hashes (for duplicate detection). */
  existingContentHashes?: Set<string> | undefined;
  /** Whether LinkedIn auth is healthy. */
  linkedinAuthHealthy?: boolean | undefined;
}

/**
 * Run the prepare pipeline for a single repository.
 *
 * Returns prepared drafts that are ready for human review.
 * Never publishes.
 */
export async function runPreparePipeline(
  owner: string,
  repo: string,
  options?: PrepareOptions,
): Promise<PreparedDraft[]> {
  // Step 1: Discover candidates
  const candidates = await analyzeRepository(owner, repo, {
    lookbackDays: options?.lookbackDays,
    scoreThreshold: options?.scoreThreshold,
  });

  // Step 2: Process each candidate
  const prepared: PreparedDraft[] = [];

  for (const candidate of candidates) {
    const draft = prepareCandidate(candidate, options);
    prepared.push(draft);
  }

  return prepared;
}

/**
 * Process a single candidate through the writing pipeline.
 */
function prepareCandidate(candidate: ContentCandidate, options?: PrepareOptions): PreparedDraft {
  // Build context from candidate facts
  const context = candidate.facts.join(". ");

  // Step 2: Extract facts
  const { facts } = extractFacts(context);

  // Step 3: Write draft
  const draft = writeDraft(facts, {
    maxWords: options?.maxWords,
    includeHashtags: options?.includeHashtags,
  });

  // Step 4: Slop guard
  const slopResult = detectSlop(draft.text);

  // Step 5: Claim verification
  const verification = verifyClaims(draft.text, facts);

  // Step 6: Review
  const review = reviewDraft(draft.text, slopResult, verification);

  // Determine status and final post based on automation mode
  let status: DraftStatus;
  let finalPost = draft.text;
  const mode = options?.automationMode ?? "safe";

  if (review.decision === "REJECTED") {
    // Always skip rejected posts
    status = "SKIPPED";
    finalPost = "";
  } else if (mode === "full") {
    // Full-auto mode: run safety checks
    const safetyResult = checkSafety(
      {
        score: candidate.score,
        unsupportedClaimCount: verification.unsupportedCount,
        slopScore: slopResult.score,
        slopPassed: slopResult.passed,
        contentHash: generateCandidateHash(candidate.repo, candidate.source, candidate.title, candidate.facts),
        existingContentHashes: options?.existingContentHashes ?? new Set(),
        visualGenerationFailed: false, // Visual generation not yet attempted
        candidateConfidence: candidate.score / 10, // Normalize to 0-1
        linkedinAuthHealthy: options?.linkedinAuthHealthy ?? true,
      },
      options?.safetyConfig,
    );

    if (safetyResult.safe && review.decision === "APPROVED") {
      // All safety checks passed and review approved
      status = "APPROVED";
    } else if (safetyResult.safe) {
      // Safety passed but review needs revision
      status = "REVIEW_REQUIRED";
      if (!slopResult.passed) {
        finalPost = removeSlopPhrases(draft.text, slopResult);
      }
    } else {
      // Safety checks failed — must review
      status = "REVIEW_REQUIRED";
      if (!slopResult.passed) {
        finalPost = removeSlopPhrases(draft.text, slopResult);
      }
    }
  } else if (mode === "semi") {
    // Semi-auto mode: schedule with approval window
    if (review.decision === "APPROVED") {
      status = "APPROVED";
    } else {
      status = "REVIEW_REQUIRED";
      if (!slopResult.passed) {
        finalPost = removeSlopPhrases(draft.text, slopResult);
      }
    }
  } else {
    // Safe mode: always require review
    if (review.decision === "APPROVED") {
      status = "REVIEW_REQUIRED"; // Even approved goes to review in safe mode
    } else {
      status = "REVIEW_REQUIRED";
      if (!slopResult.passed) {
        finalPost = removeSlopPhrases(draft.text, slopResult);
      }
    }
  }

  return {
    candidate,
    facts,
    draft,
    slopResult,
    verification,
    review,
    status,
    finalPost,
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
