// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Robust Content Validator and Quality Scorer for LinkedIn posts.
 *
 * Enforces:
 * - Content boundaries (50 - 3000 characters, >= 15 words)
 * - LinkedIn limits & markdown formatting integrity
 * - Placeholder elimination ([insert link], TODO, etc.)
 * - Hashtag rules (no duplicates, max 5, recommended 0-3)
 * - Repeated sentence detection
 * - Anti-slop / corporate buzzword screening
 * - Engineering quality metrics (technicalValue, specificity, readability, spamRisk)
 */

import { detectSlop, type SlopGuardResult } from "./slop-guard.js";

export interface ValidationMetrics {
  characterCount: number;
  wordCount: number;
  hashtagCount: number;
  technicalValue: number; // 0 - 100
  specificity: number;    // 0 - 100
  readability: number;    // 0 - 100
  spamRisk: number;       // 0 - 100 (lower is better)
  overallScore: number;   // 0 - 100
}

export interface ContentValidationReport {
  valid: boolean;
  canPublish: boolean;
  errors: string[];
  warnings: string[];
  metrics: ValidationMetrics;
  suggestions: string[];
  slopResult: SlopGuardResult;
}

const MIN_CHARACTERS = 50;
const MAX_CHARACTERS = 3000;
const MIN_WORDS = 15;
const MAX_HASHTAGS = 5;

const PLACEHOLDER_PATTERNS = [
  /\[\s*insert[^\]]*\]/gi,
  /\[\s*company[^\]]*\]/gi,
  /\[\s*link[^\]]*\]/gi,
  /\[\s*url[^\]]*\]/gi,
  /\[\s*your name[^\]]*\]/gi,
  /\bTODO\b/g,
  /\bFIXME\b/g,
  /\blorem ipsum\b/gi,
];

const TECHNICAL_KEYWORDS = [
  "api", "sdk", "backend", "frontend", "database", "sqlite", "postgres", "redis",
  "concurrency", "lock", "async", "await", "promise", "transaction", "latency",
  "throughput", "benchmark", "memory", "cpu", "docker", "kubernetes", "git",
  "commit", "refactor", "bugfix", "http", "oauth", "jwt", "payload", "endpoint",
  "architecture", "cache", "index", "query", "schema", "migration", "pipeline",
  "worker", "queue", "kafka", "event loop", "profiler", "microservice",
];

export class ContentValidator {
  /**
   * Validate a LinkedIn post text and calculate its technical quality score.
   */
  public static validate(text: string): ContentValidationReport {
    const errors: string[] = [];
    const warnings: string[] = [];
    const suggestions: string[] = [];

    const trimmed = text.trim();
    const charCount = trimmed.length;
    const words = trimmed.split(/\s+/).filter(Boolean);
    const wordCount = words.length;

    // 1. Content Length Checks
    if (charCount === 0) {
      errors.push("Post content cannot be empty.");
    } else {
      if (charCount < MIN_CHARACTERS || wordCount < MIN_WORDS) {
        errors.push(
          `Post is too short to provide technical value (${charCount} chars, ${wordCount} words). Minimum required is ${MIN_CHARACTERS} characters and ${MIN_WORDS} words.`,
        );
      }
      if (charCount > MAX_CHARACTERS) {
        errors.push(
          `Post length (${charCount} chars) exceeds LinkedIn's maximum limit of ${MAX_CHARACTERS} characters.`,
        );
      }
    }

    // 2. Placeholder Text Detection
    for (const pattern of PLACEHOLDER_PATTERNS) {
      pattern.lastIndex = 0;
      const match = pattern.exec(trimmed);
      if (match) {
        errors.push(`Unresolved placeholder text found: "${match[0]}". Remove or replace it.`);
      }
    }

    // 3. Formatting Checks
    const backticks = (trimmed.match(/`/g) || []).length;
    if (backticks % 2 !== 0) {
      errors.push("Broken formatting: unclosed backtick (`) detected in code snippet or symbol name.");
    }

    if (/\n{4,}/.test(trimmed)) {
      warnings.push("Excessive vertical blank lines detected. Consider compacting paragraph spacing.");
      suggestions.push("Limit paragraph separation to a single blank line.");
    }

    if (/\[.*?\]\(\s*\)/.test(trimmed)) {
      errors.push("Broken markdown link with empty target URL: [text]().");
    }

    // 4. Hashtag Analysis
    const hashtags = (trimmed.match(/#[\p{L}\p{N}_]+/gu) || []).map((h) => h.toLowerCase());
    const hashtagCount = hashtags.length;

    if (hashtagCount > MAX_HASHTAGS) {
      warnings.push(`Too many hashtags (${hashtagCount}). LinkedIn algorithms penalize posts with more than 3-5 tags.`);
      suggestions.push(`Keep hashtags between 0 and 3 targeted tags.`);
    }

    const uniqueHashtags = new Set(hashtags);
    if (uniqueHashtags.size < hashtags.length) {
      warnings.push("Duplicate hashtags detected.");
      suggestions.push("Remove repeated hashtag tags.");
    }

    // 5. Repeated Sentences Check
    const sentences = trimmed
      .split(/[.!?\n]/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.split(" ").length >= 6);

    const seenSentences = new Set<string>();
    for (const sentence of sentences) {
      if (seenSentences.has(sentence)) {
        warnings.push(`Repeated sentence detected: "${sentence.slice(0, 40)}..."`);
        suggestions.push("Avoid repeating identical sentences within the post.");
        break;
      }
      seenSentences.add(sentence);
    }

    // 6. Slop Guard Check
    const slopResult = detectSlop(trimmed);
    if (!slopResult.passed) {
      for (const v of slopResult.violations) {
        if (v.severity === "critical") {
          errors.push(`AI slop detected: "${v.phrase}" (${v.suggestion})`);
        } else {
          warnings.push(`AI buzzword warning: "${v.phrase}" (${v.suggestion})`);
        }
      }
    }

    // 7. Compute Quality Metrics
    const lowerText = trimmed.toLowerCase();
    let techHits = 0;
    for (const kw of TECHNICAL_KEYWORDS) {
      if (lowerText.includes(kw)) {
        techHits++;
      }
    }
    const technicalValue = Math.min(100, Math.round((techHits / 4) * 100));

    // Specificity: presence of numbers, measurements, versions, code snippets
    const hasNumbers = /\d+(?:\.\d+)?%?|\b(v\d+\.\d+|\d+ms|\d+kb|\d+mb|\d+x)\b/i.test(trimmed);
    const hasCodeSymbols = /`[^`]+`/.test(trimmed);
    const specificity = Math.min(
      100,
      (hasNumbers ? 50 : 20) + (hasCodeSymbols ? 40 : 10) + Math.min(10, techHits * 3),
    );

    // Readability: sentence lengths and structural formatting
    const avgWordsPerSentence = wordCount / Math.max(1, sentences.length);
    let readability = 90;
    if (avgWordsPerSentence > 30) readability -= 25;
    if (avgWordsPerSentence < 8) readability -= 15;
    if (!trimmed.includes("\n")) readability -= 20; // wall of text

    const spamRisk = slopResult.score;

    const overallScore = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          technicalValue * 0.35 + specificity * 0.30 + readability * 0.20 + (100 - spamRisk) * 0.15,
        ),
      ),
    );

    const valid = errors.length === 0;
    const canPublish = valid && overallScore >= 50;

    if (!canPublish && valid) {
      suggestions.push("Increase technical depth with code examples, measurements, or concrete architecture takeaways.");
    }

    return {
      valid,
      canPublish,
      errors,
      warnings,
      metrics: {
        characterCount: charCount,
        wordCount,
        hashtagCount,
        technicalValue,
        specificity,
        readability,
        spamRisk,
        overallScore,
      },
      suggestions,
      slopResult,
    };
  }
}
