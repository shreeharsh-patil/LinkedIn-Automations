// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * GitHub API client for accessing development activity.
 *
 * Uses the GitHub REST API (https://api.github.com).
 * Authentication is via a personal access token stored in GITHUB_TOKEN.
 */

/**
 * A single commit from the GitHub API.
 */
export interface GitHubCommit {
  /** SHA hash. */
  sha: string;
  /** Commit message. */
  message: string;
  /** Author name. */
  author: string;
  /** Author date (ISO 8601). */
  date: string;
  /** Files changed in this commit. */
  files: GitHubFile[];
}

/**
 * A file changed in a commit.
 */
export interface GitHubFile {
  /** File path. */
  filename: string;
  /** Change status: added, modified, removed, renamed. */
  status: string;
  /** Number of additions. */
  additions: number;
  /** Number of deletions. */
  deletions: number;
}

/**
 * A GitHub release.
 */
export interface GitHubRelease {
  /** Tag name. */
  tagName: string;
  /** Release name. */
  name: string;
  /** Release body/description. */
  body: string;
  /** Whether this is a pre-release. */
  prerelease: boolean;
  /** Creation date. */
  createdAt: string;
}

/**
 * A GitHub pull request.
 */
export interface GitHubPullRequest {
  /** PR number. */
  number: number;
  /** PR title. */
  title: string;
  /** PR body. */
  body: string;
  /** PR state: open or closed. */
  state: string;
  /** Whether merged. */
  merged: boolean;
  /** Created date. */
  createdAt: string;
  /** Merge date (if merged). */
  mergedAt: string | null;
}

/**
 * A GitHub issue.
 */
export interface GitHubIssue {
  /** Issue number. */
  number: number;
  /** Issue title. */
  title: string;
  /** Issue body. */
  body: string;
  /** Issue state: open or closed. */
  state: string;
  /** Labels. */
  labels: string[];
  /** Created date. */
  createdAt: string;
}

/**
 * Repository information.
 */
export interface GitHubRepo {
  /** Full name (owner/repo). */
  fullName: string;
  /** Repository description. */
  description: string | null;
  /** Default branch. */
  defaultBranch: string;
  /** Primary language. */
  language: string | null;
  /** Star count. */
  stars: number;
  /** Whether the repo is a fork. */
  fork: boolean;
}

/**
 * Helper to safely extract a string from an API response.
 */
function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * Helper to safely extract a number from an API response.
 */
function num(value: unknown, fallback = 0): number {
  return typeof value === "number" ? value : fallback;
}

/**
 * Helper to safely extract a boolean from an API response.
 */
function bool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * Helper to safely extract a string or null from an API response.
 */
function strOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * GitHub API client.
 */
export class GitHubClient {
  private readonly token: string | undefined;
  private readonly baseUrl = "https://api.github.com";

  constructor(token?: string) {
    this.token = token ?? process.env["GITHUB_TOKEN"];
  }

  /**
   * Check if authentication is configured.
   */
  isAuthenticated(): boolean {
    return this.token !== undefined && this.token !== "";
  }

  /**
   * Get repository information.
   */
  async getRepo(owner: string, repo: string): Promise<GitHubRepo> {
    const data = await this.request<Record<string, unknown>>(`/repos/${owner}/${repo}`);
    return {
      fullName: `${owner}/${repo}`,
      description: strOrNull(data["description"]),
      defaultBranch: str(data["default_branch"], "main"),
      language: strOrNull(data["language"]),
      stars: num(data["stargazers_count"]),
      fork: bool(data["fork"]),
    };
  }

  /**
   * Get recent commits for a repository.
   */
  async getCommits(owner: string, repo: string, since: string, maxCommits = 100): Promise<GitHubCommit[]> {
    const commits: GitHubCommit[] = [];
    let page = 1;

    while (commits.length < maxCommits) {
      const perPage = Math.min(100, maxCommits - commits.length);
      const data = await this.request<Array<Record<string, unknown>>>(
        `/repos/${owner}/${repo}/commits?since=${since}&per_page=${perPage}&page=${page}`,
      );

      if (data.length === 0) break;

      for (const item of data) {
        const commitData = item["commit"] as Record<string, unknown> | undefined;
        const authorData = commitData?.["author"] as Record<string, unknown> | undefined;

        const files = await this.getCommitFiles(owner, repo, str(item["sha"]));

        commits.push({
          sha: str(item["sha"]),
          message: str(commitData?.["message"]),
          author: str(authorData?.["name"], "unknown"),
          date: str(authorData?.["date"]),
          files,
        });

        if (commits.length >= maxCommits) break;
      }

      page++;
    }

    return commits;
  }

  /**
   * Get files changed in a specific commit.
   */
  async getCommitFiles(owner: string, repo: string, sha: string): Promise<GitHubFile[]> {
    try {
      const data = await this.request<Record<string, unknown>>(`/repos/${owner}/${repo}/commits/${sha}`);

      const files = data["files"] as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(files)) return [];

      return files.map((f) => ({
        filename: str(f["filename"]),
        status: str(f["status"], "modified"),
        additions: num(f["additions"]),
        deletions: num(f["deletions"]),
      }));
    } catch {
      return [];
    }
  }

  /**
   * Get recent releases for a repository.
   */
  async getReleases(owner: string, repo: string, maxReleases = 10): Promise<GitHubRelease[]> {
    const data = await this.request<Array<Record<string, unknown>>>(
      `/repos/${owner}/${repo}/releases?per_page=${maxReleases}`,
    );

    return data.map((r) => ({
      tagName: str(r["tag_name"]),
      name: str(r["name"]),
      body: str(r["body"]),
      prerelease: bool(r["prerelease"]),
      createdAt: str(r["created_at"]),
    }));
  }

  /**
   * Get recent pull requests for a repository.
   */
  async getPullRequests(owner: string, repo: string, maxPrs = 30): Promise<GitHubPullRequest[]> {
    const data = await this.request<Array<Record<string, unknown>>>(
      `/repos/${owner}/${repo}/pulls?state=all&per_page=${maxPrs}&sort=updated&direction=desc`,
    );

    return data.map((pr) => ({
      number: num(pr["number"]),
      title: str(pr["title"]),
      body: str(pr["body"]),
      state: str(pr["state"], "open"),
      merged: strOrNull(pr["merged_at"]) !== null,
      createdAt: str(pr["created_at"]),
      mergedAt: strOrNull(pr["merged_at"]),
    }));
  }

  /**
   * Get recent issues for a repository.
   */
  async getIssues(owner: string, repo: string, maxIssues = 30): Promise<GitHubIssue[]> {
    const data = await this.request<Array<Record<string, unknown>>>(
      `/repos/${owner}/${repo}/issues?state=all&per_page=${maxIssues}&sort=updated&direction=desc`,
    );

    return data
      .filter((i) => i["pull_request"] === undefined)
      .map((i) => ({
        number: num(i["number"]),
        title: str(i["title"]),
        body: str(i["body"]),
        state: str(i["state"], "open"),
        labels: Array.isArray(i["labels"])
          ? (i["labels"] as Array<Record<string, unknown>>).map((l) => str(l["name"]))
          : [],
        createdAt: str(i["created_at"]),
      }));
  }

  /**
   * Make an authenticated request to the GitHub API.
   */
  private async request<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };

    if (this.token !== undefined && this.token !== "") {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`GitHub API error (${response.status}): ${body}`);
    }

    return (await response.json()) as T;
  }
}
