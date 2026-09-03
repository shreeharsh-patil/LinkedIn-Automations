// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Generates LinkedIn post text from extracted facts.
 *
 * The writer produces engineer-style posts with specific technical details,
 * avoiding generic AI language and motivational filler.
 */

import type { Fact } from "./fact-extractor.js";

/**
 * Result of writing a draft.
 */
export interface DraftResult {
  /** The generated post text. */
  text: string;
  /** Number of words in the draft. */
  wordCount: number;
  /** Facts used in the draft. */
  factsUsed: string[];
}

/**
 * Options for the writer.
 */
export interface WriteOptions {
  /** Maximum word count. Defaults to 300. */
  maxWords?: number | undefined;
  /** Whether to include hashtags. Defaults to true. */
  includeHashtags?: boolean | undefined;
  /** Maximum hashtags. Defaults to 3. */
  maxHashtags?: number | undefined;
}

/**
 * Generate a LinkedIn post draft from facts.
 *
 * Rules:
 * - Write like an engineer documenting something
 * - 100-300 words
 * - Specific technical details over motivational language
 * - Mention tradeoffs when relevant
 * - 0-3 hashtags
 * - No emojis
 * - No fake enthusiasm
 */
export function writeDraft(facts: Fact[], options?: WriteOptions): DraftResult {
  const maxWords = options?.maxWords ?? 300;
  const includeHashtags = options?.includeHashtags ?? true;
  const maxHashtags = options?.maxHashtags ?? 3;

  if (facts.length === 0) {
    return {
      text: "",
      wordCount: 0,
      factsUsed: [],
    };
  }

  // Group facts by confidence
  const highConfidence = facts.filter((f) => f.confidence >= 0.8);
  const mediumConfidence = facts.filter((f) => f.confidence >= 0.5 && f.confidence < 0.8);

  // Build the post from facts
  const paragraphs: string[] = [];
  const factsUsed: string[] = [];

  // Opening: use the most concrete fact as the hook
  const hook = highConfidence[0] ?? mediumConfidence[0];
  if (hook !== undefined) {
    paragraphs.push(hook.claim);
    factsUsed.push(hook.id);
  }

  // Body: add supporting facts
  const bodyFacts = [...highConfidence.slice(1), ...mediumConfidence.slice(1)];
  for (const fact of bodyFacts) {
    if (paragraphs.length >= 4) break;

    // Avoid repeating the same claim
    const isDuplicate = paragraphs.some((p) => similarity(p, fact.claim) > 0.7);
    if (isDuplicate) continue;

    paragraphs.push(fact.claim);
    factsUsed.push(fact.id);
  }

  // Compose final text
  let text = paragraphs.join("\n\n");

  // Add hashtags if requested
  if (includeHashtags && factsUsed.length > 0) {
    const hashtags = extractHashtags(facts, maxHashtags);
    if (hashtags.length > 0) {
      text += "\n\n" + hashtags.join(" ");
    }
  }

  // Enforce word limit
  const words = text.split(/\s+/);
  if (words.length > maxWords) {
    text = words.slice(0, maxWords).join(" ") + "...";
  }

  const wordCount = text.split(/\s+/).length;

  return { text, wordCount, factsUsed };
}

/**
 * Simple text similarity (Jaccard index on word sets).
 */
function similarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

/**
 * Extract relevant hashtags from facts.
 */
function extractHashtags(facts: Fact[], max: number): string[] {
  const techKeywords = new Map<string, number>();

  const keywords = [
    "typescript",
    "python",
    "rust",
    "golang",
    "nodejs",
    "react",
    "vue",
    "angular",
    "fastapi",
    "django",
    "express",
    "postgresql",
    "mysql",
    "redis",
    "docker",
    "kubernetes",
    "aws",
    "gcp",
    "azure",
    "microservices",
    "api",
    "oauth",
    "testing",
    "ci",
    "cd",
    "devops",
    "performance",
    "security",
    "architecture",
    "database",
    "cache",
    "async",
    "concurrency",
  ];

  for (const fact of facts) {
    const lower = fact.claim.toLowerCase();
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        techKeywords.set(kw, (techKeywords.get(kw) ?? 0) + 1);
      }
    }
  }

  return [...techKeywords.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([kw]) => `#${kw}`);
}
