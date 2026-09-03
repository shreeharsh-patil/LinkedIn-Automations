// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Groups related commits into technical stories.
 *
 * Instead of one post per commit, groups commits that relate to
 * the same feature, fix, or change into a single candidate.
 */

import type { CommitAnalysis } from "./commit-analyzer.js";

/**
 * A group of related commits forming a technical story.
 */
export interface CommitGroup {
  /** Group identifier. */
  id: string;
  /** Title derived from the group. */
  title: string;
  /** All commits in this group. */
  commits: CommitAnalysis[];
  /** Key files across all commits. */
  keyFiles: string[];
  /** Combined summary. */
  summary: string;
  /** Time span of the group (first to last commit). */
  timeSpan: { first: string; last: string };
}

/**
 * Maximum time gap (in hours) between commits to consider them related.
 */
const MAX_GAP_HOURS = 48;

/**
 * Group related commits into technical stories.
 *
 * Commits are grouped if:
 * 1. They share significant file overlap
 * 2. They are within MAX_GAP_HOURS of each other
 * 3. They have the same or related commit type
 */
export function groupCommits(analyses: CommitAnalysis[]): CommitGroup[] {
  if (analyses.length === 0) return [];

  // Sort by date
  const sorted = [...analyses].sort((a, b) => new Date(a.commit.date).getTime() - new Date(b.commit.date).getTime());

  const groups: CommitGroup[] = [];
  const first = sorted[0];
  if (first === undefined) return [];
  let currentGroup: CommitAnalysis[] = [first];
  let groupId = 1;

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (prev === undefined || curr === undefined) continue;

    const gapHours = (new Date(curr.commit.date).getTime() - new Date(prev.commit.date).getTime()) / (1000 * 60 * 60);

    const fileOverlap = calculateFileOverlap(prev.keyFiles, curr.keyFiles);
    const typeRelated = isRelatedType(prev.type, curr.type);

    // Group if: within time gap AND (share files OR related type)
    if (gapHours <= MAX_GAP_HOURS && (fileOverlap > 0.2 || typeRelated)) {
      currentGroup.push(curr);
    } else {
      // Finalize current group
      if (currentGroup.length > 0) {
        groups.push(buildGroup(currentGroup, groupId));
        groupId++;
      }
      currentGroup = [curr];
    }
  }

  // Finalize last group
  if (currentGroup.length > 0) {
    groups.push(buildGroup(currentGroup, groupId));
  }

  return groups;
}

/**
 * Calculate file overlap between two sets of file paths.
 * Returns a value between 0 (no overlap) and 1 (identical).
 */
function calculateFileOverlap(filesA: string[], filesB: string[]): number {
  if (filesA.length === 0 || filesB.length === 0) return 0;

  const dirsA = new Set(filesA.map((f) => f.split("/").slice(0, -1).join("/")));
  const dirsB = new Set(filesB.map((f) => f.split("/").slice(0, -1).join("/")));

  const intersection = new Set([...dirsA].filter((d) => dirsB.has(d)));
  const union = new Set([...dirsA, ...dirsB]);

  return union.size === 0 ? 0 : intersection.size / union.size;
}

/**
 * Check if two commit types are related.
 */
function isRelatedType(a: string, b: string): boolean {
  const relatedGroups = [
    ["feature", "refactor"],
    ["bugfix", "test"],
    ["performance", "architecture"],
    ["security", "feature"],
  ];

  return relatedGroups.some((group) => group.includes(a) && group.includes(b));
}

/**
 * Build a CommitGroup from a list of analyses.
 */
function buildGroup(analyses: CommitAnalysis[], id: number): CommitGroup {
  const allFiles = analyses.flatMap((a) => a.keyFiles);
  const uniqueFiles = [...new Set(allFiles)].slice(0, 10);

  // Use the most meaningful commit's message as the title
  const title =
    analyses
      .filter((a) => a.meaningful)
      .sort((a, b) => b.linesChanged - a.linesChanged)[0]
      ?.commit.message.split("\n")[0] ??
    analyses[0]?.commit.message.split("\n")[0] ??
    "Unknown change";

  const summaries = analyses.map((a) => a.summary);
  const summary =
    analyses.length === 1
      ? (summaries[0] ?? "")
      : `Combined ${analyses.length} related changes:\n${summaries.map((s) => `• ${s}`).join("\n")}`;

  const dates = analyses.map((a) => a.commit.date).sort();

  return {
    id: `group-${id}`,
    title: truncate(title, 100),
    commits: analyses,
    keyFiles: uniqueFiles,
    summary,
    timeSpan: {
      first: dates[0] ?? "",
      last: dates[dates.length - 1] ?? "",
    },
  };
}

/**
 * Truncate text to a maximum length.
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}
