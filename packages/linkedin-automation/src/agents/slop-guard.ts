// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Detects and rejects AI-generated LinkedIn slop.
 *
 * Posts that contain these patterns are flagged for rewriting.
 * The guard never auto-rewrites — it only reports issues.
 */

/**
 * Severity levels for slop violations.
 */
export type SlopSeverity = "critical" | "warning";

/**
 * A single slop violation detected in the text.
 */
export interface SlopViolation {
  /** The matched phrase. */
  phrase: string;
  /** Severity level. */
  severity: SlopSeverity;
  /** Category of slop. */
  category: string;
  /** Suggested fix. */
  suggestion: string;
}

/**
 * Result of slop guard analysis.
 */
export interface SlopGuardResult {
  /** Whether the text passes the slop guard. */
  passed: boolean;
  /** Detected violations. */
  violations: SlopViolation[];
  /** Slop score (0 = clean, 100 = pure slop). */
  score: number;
  /** Human-readable summary. */
  summary: string;
}

/**
 * Critical phrases that must never appear in a post.
 * These are hallmarks of AI-generated LinkedIn content.
 */
const CRITICAL_PHRASES: ReadonlyArray<{ pattern: RegExp; category: string; suggestion: string }> = [
  {
    pattern: /\bexcited to share\b/gi,
    category: "fake-enthusiasm",
    suggestion: "State what you built or learned directly",
  },
  {
    pattern: /\bthrilled to announce\b/gi,
    category: "fake-enthusiasm",
    suggestion: "Announce the fact without emotional framing",
  },
  {
    pattern: /\bgame[\s-]changer\b/gi,
    category: "corporate-jargon",
    suggestion: "Describe the specific impact instead",
  },
  {
    pattern: /\brevolutionary\b/gi,
    category: "corporate-jargon",
    suggestion: "Use a more specific descriptor",
  },
  {
    pattern: /\bunleashing the power\b/gi,
    category: "corporate-jargon",
    suggestion: "Describe what the tool actually does",
  },
  {
    pattern: /\bunlocking the power\b/gi,
    category: "corporate-jargon",
    suggestion: "Describe the actual capability",
  },
  {
    pattern: /\bin today'?s rapidly evolving world\b/gi,
    category: "motivational-filler",
    suggestion: "Start with the specific problem or context",
  },
  {
    pattern: /\bthe future is here\b/gi,
    category: "motivational-filler",
    suggestion: "Describe what changed concretely",
  },
  {
    pattern: /\bdelve into\b/gi,
    category: "corporate-jargon",
    suggestion: "Use 'explore', 'investigate', or 'look at'",
  },
  {
    pattern: /\btransforming the landscape\b/gi,
    category: "corporate-jargon",
    suggestion: "Describe the specific change",
  },
  {
    pattern: /\bseamlessly\b/gi,
    category: "corporate-jargon",
    suggestion: "Remove or describe the integration specifically",
  },
  {
    pattern: /\bthis isn'?t just .+ it'?s .+/gi,
    category: "engagement-bait",
    suggestion: "State the facts directly",
  },
  {
    pattern: /\bhere'?s the thing\b/gi,
    category: "engagement-bait",
    suggestion: "Start with the technical point",
  },
];

/**
 * Warning-level patterns that suggest slop but aren't critical.
 */
const WARNING_PHRASES: ReadonlyArray<{ pattern: RegExp; category: string; suggestion: string }> = [
  {
    pattern: /\bleverage\b/gi,
    category: "corporate-jargon",
    suggestion: "Use 'use' or 'apply'",
  },
  {
    pattern: /\bsynergy\b/gi,
    category: "corporate-jargon",
    suggestion: "Describe the actual interaction",
  },
  {
    pattern: /\bparadigm shift\b/gi,
    category: "corporate-jargon",
    suggestion: "Describe the specific change in approach",
  },
  {
    pattern: /\bbest[\s-]in[\s-]class\b/gi,
    category: "corporate-jargon",
    suggestion: "Compare to specific alternatives",
  },
  {
    pattern: /\bcutting[\s-]edge\b/gi,
    category: "corporate-jargon",
    suggestion: "Describe what makes it novel",
  },
  {
    pattern: /\bthought[\s-]leader\b/gi,
    category: "engagement-bait",
    suggestion: "Share the actual insight",
  },
];

/**
 * Patterns that indicate engagement bait.
 */
const ENGAGEMENT_BAIT: ReadonlyArray<{ pattern: RegExp; category: string; suggestion: string }> = [
  {
    pattern: /\bthoughts\??\s*$/gim,
    category: "engagement-bait",
    suggestion: "End with a statement, not a question",
  },
  {
    pattern: /\bagree\??\s*$/gim,
    category: "engagement-bait",
    suggestion: "End with a statement or insight",
  },
  {
    pattern: /\bwhat do you think\??\s*$/gim,
    category: "engagement-bait",
    suggestion: "End with a technical conclusion",
  },
  {
    pattern: /#\w+(?:\s+#\w+){5,}/g,
    category: "excessive-hashtags",
    suggestion: "Use 0-3 hashtags maximum",
  },
];

/**
 * Analyze text for AI slop patterns.
 */
export function detectSlop(text: string): SlopGuardResult {
  const violations: SlopViolation[] = [];

  // Check critical phrases
  for (const { pattern, category, suggestion } of CRITICAL_PHRASES) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match !== null) {
      violations.push({
        phrase: match[0],
        severity: "critical",
        category,
        suggestion,
      });
    }
  }

  // Check warning phrases
  for (const { pattern, category, suggestion } of WARNING_PHRASES) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match !== null) {
      violations.push({
        phrase: match[0],
        severity: "warning",
        category,
        suggestion,
      });
    }
  }

  // Check engagement bait
  for (const { pattern, category, suggestion } of ENGAGEMENT_BAIT) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match !== null) {
      violations.push({
        phrase: match[0].trim(),
        severity: "critical",
        category,
        suggestion,
      });
    }
  }

  // Check emoji density
  const emojiCount = (text.match(/\p{Emoji_Presentation}/gu) ?? []).length;
  const wordCount = text.split(/\s+/).length;
  if (wordCount > 0 && emojiCount / wordCount > 0.05) {
    violations.push({
      phrase: `${emojiCount} emojis detected`,
      severity: "warning",
      category: "excessive-emojis",
      suggestion: "Reduce emoji usage — engineers rarely use emojis in technical posts",
    });
  }

  // Calculate score
  const criticalCount = violations.filter((v) => v.severity === "critical").length;
  const warningCount = violations.filter((v) => v.severity === "warning").length;
  const score = Math.min(100, criticalCount * 25 + warningCount * 10);

  const passed = criticalCount === 0;

  const summary =
    violations.length === 0
      ? "No AI slop detected."
      : `Found ${criticalCount} critical and ${warningCount} warning violations.`;

  return { passed, violations, score, summary };
}
