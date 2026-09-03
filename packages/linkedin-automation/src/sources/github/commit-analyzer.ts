// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Analyzes individual commits to extract technical signals.
 *
 * Classifies commits by type and extracts meaningful information
 * for content candidate generation.
 */

import type { GitHubCommit, GitHubFile } from "./github-client.js";

/**
 * Classification of a commit's technical nature.
 */
export type CommitType =
  | "feature"
  | "bugfix"
  | "performance"
  | "security"
  | "architecture"
  | "refactor"
  | "docs"
  | "deps"
  | "ci"
  | "test"
  | "style"
  | "generated"
  | "unknown";

/**
 * Analysis result for a single commit.
 */
export interface CommitAnalysis {
  /** The original commit. */
  commit: GitHubCommit;
  /** Classified commit type. */
  type: CommitType;
  /** Extracted technical summary. */
  summary: string;
  /** Key files changed (most significant). */
  keyFiles: string[];
  /** Total lines changed. */
  linesChanged: number;
  /** Whether this is a meaningful technical change. */
  meaningful: boolean;
}

/**
 * Patterns in commit messages that indicate commit type.
 */
const MESSAGE_PATTERNS: ReadonlyArray<{ pattern: RegExp; type: CommitType }> = [
  // Features
  { pattern: /\b(add|implement|introduce|create|enable|support|feat)\b/i, type: "feature" },
  // Bug fixes
  { pattern: /\b(fix|bug|resolve|patch|correct|repair)\b/i, type: "bugfix" },
  // Performance
  { pattern: /\b(perf|performance|speed|fast|optim|cache|latency|throughput)\b/i, type: "performance" },
  // Security
  { pattern: /\b(security|vuln|cve|auth|encrypt|token|sanitize|xss|sqli)\b/i, type: "security" },
  // Architecture
  { pattern: /\b(architect|refactor|restructur|reorganiz|migrat|redesign)\b/i, type: "architecture" },
  // Dependencies
  { pattern: /\b(deps?|bump|upgrade|update)\s+(dep|package|lib|depend)/i, type: "deps" },
  // CI/CD
  { pattern: /\b(ci|cd|pipeline|workflow|deploy|action|runner)\b/i, type: "ci" },
  // Tests
  { pattern: /\b(test|spec|coverage|mock|assert)\b/i, type: "test" },
  // Docs
  { pattern: /\b(doc|readme|changelog|comment|typo)\b/i, type: "docs" },
  // Style/formatting
  { pattern: /\b(format|lint|style|whitespace|indent|prettier|eslint)\b/i, type: "style" },
];

/**
 * File patterns that indicate generated or trivial files.
 */
const TRIVIAL_FILE_PATTERNS: ReadonlyArray<RegExp> = [
  /package-lock\.json$/i,
  /pnpm-lock\.yaml$/i,
  /yarn\.lock$/i,
  /\.min\.js$/i,
  /\.min\.css$/i,
  /dist\//i,
  /build\//i,
  /node_modules\//i,
  /\.map$/,
  /generated/i,
];

/**
 * Analyze a single commit.
 */
export function analyzeCommit(commit: GitHubCommit): CommitAnalysis {
  const message = commit.message.split("\n")[0] ?? "";

  // Classify commit type
  let type: CommitType = "unknown";
  for (const { pattern, type: detectedType } of MESSAGE_PATTERNS) {
    if (pattern.test(message)) {
      type = detectedType;
      break;
    }
  }

  // Analyze files
  const keyFiles = extractKeyFiles(commit.files);
  const linesChanged = commit.files.reduce((sum, f) => sum + f.additions + f.deletions, 0);

  // Check if files are generated/trivial
  const hasGeneratedFiles = commit.files.some((f) => TRIVIAL_FILE_PATTERNS.some((p) => p.test(f.filename)));

  // Determine if meaningful
  const meaningful = !hasGeneratedFiles && linesChanged > 5 && type !== "style" && type !== "docs" && type !== "ci";

  // Generate summary
  const summary = generateSummary(message, type, commit.files);

  return {
    commit,
    type,
    summary,
    keyFiles,
    linesChanged,
    meaningful,
  };
}

/**
 * Extract the most significant file paths from changed files.
 */
function extractKeyFiles(files: GitHubFile[]): string[] {
  return files
    .filter((f) => {
      // Skip trivial files
      if (TRIVIAL_FILE_PATTERNS.some((p) => p.test(f.filename))) return false;
      // Skip very small changes
      if (f.additions + f.deletions < 3) return false;
      return true;
    })
    .sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions))
    .slice(0, 5)
    .map((f) => f.filename);
}

/**
 * Generate a technical summary from commit data.
 */
function generateSummary(message: string, type: CommitType, files: GitHubFile[]): string {
  const firstLine = message.split("\n")[0] ?? "";
  const fileCount = files.length;
  const ext = files[0]?.filename.split(".").pop();

  const typeLabels: Record<CommitType, string> = {
    feature: "New feature",
    bugfix: "Bug fix",
    performance: "Performance improvement",
    security: "Security improvement",
    architecture: "Architecture change",
    refactor: "Refactoring",
    docs: "Documentation",
    deps: "Dependency update",
    ci: "CI/CD change",
    test: "Test change",
    style: "Style/formatting",
    generated: "Generated file",
    unknown: "Change",
  };

  const parts = [typeLabels[type]];
  if (fileCount > 0) {
    parts.push(`across ${fileCount} file(s)`);
  }
  if (ext !== undefined) {
    parts.push(`(${ext})`);
  }
  parts.push(`: ${firstLine}`);

  return parts.join(" ");
}
