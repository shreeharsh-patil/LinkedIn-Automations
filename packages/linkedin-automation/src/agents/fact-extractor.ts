// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Extracts structured facts from user-provided technical context.
 *
 * Facts are the atomic units of truth that the writer can use
 * and the claim verifier can check.
 */

/**
 * A single extracted fact.
 */
export interface Fact {
  /** Unique identifier for the fact. */
  id: string;
  /** The factual claim text. */
  claim: string;
  /** Where this fact came from. */
  source: "user-context" | "repository" | "commit" | "release" | "issue";
  /** Confidence level (0-1). 1 = explicitly stated, 0.5 = inferred. */
  confidence: number;
}

/**
 * Result of fact extraction.
 */
export interface FactExtractionResult {
  /** Extracted facts. */
  facts: Fact[];
  /** Summary of the technical context. */
  summary: string;
}

/**
 * Simple keyword-based fact extraction from user context.
 *
 * This is a deterministic extractor — no AI calls needed.
 * It identifies factual statements by looking for concrete technical indicators.
 */

/**
 * Patterns that indicate a concrete technical fact.
 */
const FACT_PATTERNS: ReadonlyArray<{ pattern: RegExp; confidence: number }> = [
  // Technology/framework mentions
  { pattern: /\b(uses?|using|built with|runs on|powered by|based on)\s+(\w[\w\s-]*\w)/gi, confidence: 1.0 },
  // Performance claims with numbers
  {
    pattern:
      /\b(\d+(?:\.\d+)?x?|\d+%)\s*(faster|slower|improvement|reduction|increase|decrease|more|less|better|worse)/gi,
    confidence: 0.8,
  },
  // Version releases
  { pattern: /\brelease[ds]?\s+(?:v?(\d+\.\d+(?:\.\d+)?))?\b/gi, confidence: 1.0 },
  // Bug fixes
  { pattern: /\b(fixed?|resolved?|patched?|corrected?)\s+(?:a\s+)?(.{10,60})/gi, confidence: 0.9 },
  // Architecture decisions
  { pattern: /\b(migrated?|refactored?|redesigned?|replaced?)\s+(?:from\s+)?(.{10,60})/gi, confidence: 0.9 },
  // File/code references
  { pattern: /\b(in|at|from|through)\s+([/\w.-]+\.(?:ts|js|py|rs|go|java|yaml|json|toml))/gi, confidence: 1.0 },
];

/**
 * Extract facts from user-provided technical context.
 */
export function extractFacts(context: string): FactExtractionResult {
  const facts: Fact[] = [];
  let factId = 0;

  // Split into sentences
  const sentences = context
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 5);

  for (const sentence of sentences) {
    for (const { pattern, confidence } of FACT_PATTERNS) {
      // Reset regex state
      pattern.lastIndex = 0;
      if (pattern.test(sentence)) {
        factId++;
        facts.push({
          id: `fact-${factId}`,
          claim: sentence,
          source: "user-context",
          confidence,
        });
        break; // One fact per sentence
      }
    }
  }

  // If no patterns matched, treat each meaningful sentence as a low-confidence fact
  if (facts.length === 0) {
    for (const sentence of sentences) {
      if (sentence.length > 15) {
        factId++;
        facts.push({
          id: `fact-${factId}`,
          claim: sentence,
          source: "user-context",
          confidence: 0.5,
        });
      }
    }
  }

  // Generate summary
  const summary =
    facts.length > 0
      ? `Extracted ${facts.length} fact(s) from provided context.`
      : "No concrete facts extracted from context.";

  return { facts, summary };
}
