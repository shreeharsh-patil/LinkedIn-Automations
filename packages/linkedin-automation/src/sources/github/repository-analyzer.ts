// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Analyzes a GitHub repository to produce content candidates.
 *
 * Orchestrates: GitHub API → commit analysis → grouping → scoring → candidates
 */

import { GitHubClient } from "./github-client.js";
import { analyzeCommit } from "./commit-analyzer.js";
import { groupCommits } from "./change-grouper.js";
import type { CommitGroup } from "./change-grouper.js";
import { scoreActivity, scoreRelease, DEFAULT_POST_SCORE_THRESHOLD } from "./activity-scorer.js";

/**
 * A content candidate ready for the writing pipeline.
 */
export interface ContentCandidate {
  /** Unique identifier. */
  id: string;
  /** Repository (owner/repo). */
  repo: string;
  /** Source type: commits, release, pr, issue. */
  source: "commits" | "release" | "pull-request" | "issue";
  /** Numeric score. */
  score: number;
  /** Title for the candidate. */
  title: string;
  /** Technical facts extracted from the source. */
  facts: string[];
  /** Why this qualifies as a post. */
  reason: string;
  /** Supporting commits (SHAs). */
  supportingCommits: string[];
  /** Supporting files. */
  supportingFiles: string[];
  /** When this candidate was created. */
  createdAt: string;
}

/**
 * Options for repository analysis.
 */
export interface AnalysisOptions {
  /** Lookback period in days (default: 7). */
  lookbackDays?: number | undefined;
  /** Maximum candidates to return (default: 10). */
  maxCandidates?: number | undefined;
  /** Score threshold (default: 5). */
  scoreThreshold?: number | undefined;
}

/**
 * Analyze a repository and produce content candidates.
 */
export async function analyzeRepository(
  owner: string,
  repo: string,
  options?: AnalysisOptions,
): Promise<ContentCandidate[]> {
  const lookbackDays = options?.lookbackDays ?? 7;
  const maxCandidates = options?.maxCandidates ?? 10;
  const scoreThreshold = options?.scoreThreshold ?? DEFAULT_POST_SCORE_THRESHOLD;

  const client = new GitHubClient();
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const candidates: ContentCandidate[] = [];

  // 1. Check for recent releases
  const releases = await client.getReleases(owner, repo, 5);
  const recentReleases = releases.filter((r) => new Date(r.createdAt) >= new Date(since) && !r.prerelease);

  for (const release of recentReleases) {
    const scored = scoreRelease(release);
    if (scored.score >= scoreThreshold) {
      candidates.push({
        id: release.tagName,
        repo: `${owner}/${repo}`,
        source: "release",
        score: scored.score,
        title: `Release ${release.tagName}${release.name !== "" ? `: ${release.name}` : ""}`,
        facts: [`Released ${release.tagName}`, release.body !== "" ? release.body.slice(0, 500) : ""].filter(
          (f) => f !== "",
        ),
        reason: `New release detected (${scored.factors.join(", ")})`,
        supportingCommits: [],
        supportingFiles: [],
        createdAt: new Date().toISOString(),
      });
    }
  }

  // 2. Analyze commits
  const commits = await client.getCommits(owner, repo, since, 100);
  const analyses = commits.map(analyzeCommit);

  // 3. Filter meaningful commits
  const meaningful = analyses.filter((a) => a.meaningful);

  // 4. Group related commits
  const groups = groupCommits(meaningful);

  // 5. Score each group
  for (const group of groups) {
    const scored = scoreActivity(group.commits);
    if (scored.score >= scoreThreshold) {
      candidates.push({
        id: group.id,
        repo: `${owner}/${repo}`,
        source: "commits",
        score: scored.score,
        title: group.title,
        facts: extractFactsFromGroup(group),
        reason: `Technical activity detected (${scored.factors.join(", ")})`,
        supportingCommits: group.commits.map((a) => a.commit.sha),
        supportingFiles: group.keyFiles,
        createdAt: new Date().toISOString(),
      });
    }
  }

  // 6. Sort by score and limit
  return candidates.sort((a, b) => b.score - a.score).slice(0, maxCandidates);
}

/**
 * Extract technical facts from a commit group.
 */
function extractFactsFromGroup(group: CommitGroup): string[] {
  const facts: string[] = [];

  // Use commit messages as facts
  for (const analysis of group.commits.slice(0, 5)) {
    const message = analysis.commit.message.split("\n")[0];
    if (message !== undefined && message.length > 10) {
      facts.push(message);
    }
  }

  // Add file context
  if (group.keyFiles.length > 0) {
    facts.push(`Changed files: ${group.keyFiles.slice(0, 5).join(", ")}`);
  }

  return facts;
}
