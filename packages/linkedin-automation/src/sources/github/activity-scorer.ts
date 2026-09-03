// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Scores GitHub activity for LinkedIn post potential.
 *
 * Combines commit analysis, release detection, and file change patterns
 * to produce a numeric score indicating how suitable activity is for a post.
 */

import type { CommitAnalysis, CommitType } from "./commit-analyzer.js";
import type { GitHubRelease } from "./github-client.js";

/**
 * Score thresholds.
 */
export const DEFAULT_POST_SCORE_THRESHOLD = 5;

/**
 * Base scores by commit type.
 */
const TYPE_SCORES: Record<CommitType, number> = {
  feature: 5,
  bugfix: 4,
  performance: 4,
  security: 4,
  architecture: 5,
  refactor: 2,
  deps: -5,
  ci: 0,
  test: 0,
  docs: -10,
  style: -10,
  generated: -10,
  unknown: 0,
};

/**
 * Scoring rules for file patterns.
 */
const FILE_BONUS_PATTERNS: ReadonlyArray<{ pattern: RegExp; bonus: number }> = [
  // New project indicators
  { pattern: /\bpackage\.json$/i, bonus: 2 },
  { pattern: /\bpyproject\.toml$/i, bonus: 2 },
  { pattern: /\bCargo\.toml$/i, bonus: 2 },
  // Core source files
  { pattern: /\bapp\.(ts|js|py)$/i, bonus: 2 },
  { pattern: /\bserver\.(ts|js)$/i, bonus: 2 },
  { pattern: /\bmain\.(ts|js|py)$/i, bonus: 2 },
  // Architecture files
  { pattern: /docker/i, bonus: 1 },
  { pattern: /kubernetes|k8s/i, bonus: 1 },
  { pattern: /\.github\/workflows/i, bonus: 1 },
];

/**
 * Negative file patterns (trivial changes).
 */
const TRIVIAL_BONUS_PATTERNS: ReadonlyArray<{ pattern: RegExp; penalty: number }> = [
  { pattern: /readme/i, penalty: -3 },
  { pattern: /\.md$/, penalty: -2 },
  { pattern: /license/i, penalty: -3 },
  { pattern: /\.gitignore$/i, penalty: -2 },
  { pattern: /prettier|eslint|editorconfig/i, penalty: -2 },
];

/**
 * Scored activity result.
 */
export interface ScoredActivity {
  /** Numeric score. */
  score: number;
  /** Whether score meets the threshold. */
  qualifies: boolean;
  /** Breakdown of scoring factors. */
  factors: string[];
}

/**
 * Score a set of related commit analyses.
 */
export function scoreActivity(analyses: CommitAnalysis[]): ScoredActivity {
  let score = 0;
  const factors: string[] = [];

  for (const analysis of analyses) {
    // Base type score
    const typeScore = TYPE_SCORES[analysis.type];
    score += typeScore;
    if (typeScore !== 0) {
      factors.push(`${analysis.type}: ${typeScore > 0 ? "+" : ""}${typeScore}`);
    }

    // File pattern bonuses
    for (const file of analysis.keyFiles) {
      for (const { pattern, bonus } of FILE_BONUS_PATTERNS) {
        if (pattern.test(file)) {
          score += bonus;
          factors.push(`file ${file}: +${bonus}`);
        }
      }
      for (const { pattern, penalty } of TRIVIAL_BONUS_PATTERNS) {
        if (pattern.test(file)) {
          score += penalty;
          factors.push(`file ${file}: ${penalty}`);
        }
      }
    }

    // Lines changed bonus (diminishing returns)
    if (analysis.linesChanged > 100) {
      const bonus = Math.min(3, Math.floor(analysis.linesChanged / 100));
      score += bonus;
      factors.push(`large change: +${bonus}`);
    }
  }

  // Deduplicate factors
  const uniqueFactors = [...new Set(factors)];

  return {
    score,
    qualifies: score >= DEFAULT_POST_SCORE_THRESHOLD,
    factors: uniqueFactors,
  };
}

/**
 * Score a release for post potential.
 */
export function scoreRelease(release: GitHubRelease): ScoredActivity {
  let score = 5; // Releases are always interesting
  const factors: string[] = ["release: +5"];

  if (release.prerelease) {
    score -= 2;
    factors.push("prerelease: -2");
  }

  // Major version bump is more interesting
  const versionMatch = release.tagName.match(/v?(\d+)\./);
  if (versionMatch?.[1] === "1" && release.tagName.includes(".0.0")) {
    score += 1;
    factors.push("initial major release: +1");
  }

  return {
    score,
    qualifies: score >= DEFAULT_POST_SCORE_THRESHOLD,
    factors,
  };
}
