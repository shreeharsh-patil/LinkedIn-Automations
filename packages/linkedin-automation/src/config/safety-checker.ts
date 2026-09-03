// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Full-auto safety checker.
 *
 * Validates posts before publishing in FULL mode.
 * When uncertain, moves to REVIEW_REQUIRED.
 * Never guesses.
 */

/**
 * Safety check result.
 */
export interface SafetyCheckResult {
  /** Whether the post is safe to auto-publish. */
  safe: boolean;
  /** List of failed checks. */
  failures: SafetyFailure[];
  /** Human-readable summary. */
  summary: string;
}

/**
 * A single safety check failure.
 */
export interface SafetyFailure {
  /** The check that failed. */
  check: SafetyCheck;
  /** Reason for failure. */
  reason: string;
  /** Whether this is a hard failure (must not publish) or soft (should review). */
  severity: "hard" | "soft";
}

/**
 * Available safety checks.
 */
export type SafetyCheck =
  | "score_threshold"
  | "unsupported_claims"
  | "slop_guard"
  | "duplicate_suspected"
  | "visual_generation_failed"
  | "linkedin_auth_unhealthy"
  | "candidate_confidence_low";

/**
 * Configuration for safety checks.
 */
export interface SafetyCheckConfig {
  /** Minimum score threshold (from automation settings). */
  scoreThreshold: number;
  /** Maximum allowed slop score (0-100). */
  maxSlopScore: number;
  /** Minimum candidate confidence (0-1). */
  minCandidateConfidence: number;
  /** Whether visual generation is mandatory. */
  visualMandatory: boolean;
}

/**
 * Default safety check configuration.
 */
export const DEFAULT_SAFETY_CONFIG: SafetyCheckConfig = {
  scoreThreshold: 5,
  maxSlopScore: 30,
  minCandidateConfidence: 0.5,
  visualMandatory: false,
};

/**
 * Check if a post is safe for auto-publishing.
 *
 * @param params - The post parameters to validate.
 * @param config - Safety check configuration.
 * @returns Safety check result.
 */
export function checkSafety(
  params: {
    score: number;
    unsupportedClaimCount: number;
    slopScore: number;
    slopPassed: boolean;
    contentHash: string;
    existingContentHashes: Set<string>;
    visualGenerationFailed: boolean;
    candidateConfidence: number;
    linkedinAuthHealthy: boolean;
  },
  config?: Partial<SafetyCheckConfig>,
): SafetyCheckResult {
  const cfg: SafetyCheckConfig = { ...DEFAULT_SAFETY_CONFIG, ...config };
  const failures: SafetyFailure[] = [];

  // 1. Score threshold check
  if (params.score < cfg.scoreThreshold) {
    failures.push({
      check: "score_threshold",
      reason: `Score ${params.score} is below threshold ${cfg.scoreThreshold}`,
      severity: "hard",
    });
  }

  // 2. Unsupported claims check
  if (params.unsupportedClaimCount > 0) {
    failures.push({
      check: "unsupported_claims",
      reason: `${params.unsupportedClaimCount} unsupported claim(s) remain`,
      severity: "hard",
    });
  }

  // 3. SlopGuard check
  if (!params.slopPassed || params.slopScore > cfg.maxSlopScore) {
    failures.push({
      check: "slop_guard",
      reason: `SlopGuard failed or score ${params.slopScore} exceeds max ${cfg.maxSlopScore}`,
      severity: "hard",
    });
  }

  // 4. Duplicate check
  if (params.existingContentHashes.has(params.contentHash)) {
    failures.push({
      check: "duplicate_suspected",
      reason: "Content hash matches an existing post",
      severity: "hard",
    });
  }

  // 5. Visual generation check (only if mandatory)
  if (cfg.visualMandatory && params.visualGenerationFailed) {
    failures.push({
      check: "visual_generation_failed",
      reason: "Visual generation failed but image is mandatory",
      severity: "hard",
    });
  }

  // 6. LinkedIn auth check
  if (!params.linkedinAuthHealthy) {
    failures.push({
      check: "linkedin_auth_unhealthy",
      reason: "LinkedIn authentication is unhealthy or expired",
      severity: "hard",
    });
  }

  // 7. Candidate confidence check
  if (params.candidateConfidence < cfg.minCandidateConfidence) {
    failures.push({
      check: "candidate_confidence_low",
      reason: `Candidate confidence ${params.candidateConfidence} is below minimum ${cfg.minCandidateConfidence}`,
      severity: "soft",
    });
  }

  const safe = failures.filter((f) => f.severity === "hard").length === 0;

  const summary = safe
    ? "All safety checks passed."
    : `Failed ${failures.length} safety check(s): ${failures.map((f) => f.check).join(", ")}`;

  return { safe, failures, summary };
}
