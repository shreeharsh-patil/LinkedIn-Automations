// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";

import {
  createDeduplicationStore,
  isDuplicateCandidate,
  markAsSeen,
  filterDuplicates,
  isDuplicateDraft,
  markDraftAsSeen,
} from "./deduplication.js";
import type { ContentCandidate } from "../sources/github/repository-analyzer.js";

function makeCandidate(id: string, commits: string[] = [], title = "Test candidate"): ContentCandidate {
  return {
    id,
    repo: "owner/repo",
    source: "commits",
    score: 5,
    title,
    facts: ["Test fact"],
    reason: "Test",
    supportingCommits: commits,
    supportingFiles: [],
    createdAt: new Date().toISOString(),
  };
}

describe("createDeduplicationStore", () => {
  it("creates empty store", () => {
    const store = createDeduplicationStore();
    expect(store.seenSourceIds.size).toBe(0);
    expect(store.seenContentHashes.size).toBe(0);
  });
});

describe("isDuplicateCandidate", () => {
  it("returns not duplicate for new candidate", () => {
    const store = createDeduplicationStore();
    const candidate = makeCandidate("c1", ["abc123"]);

    const result = isDuplicateCandidate(candidate, store);
    expect(result.isDuplicate).toBe(false);
  });

  it("detects duplicate commit SHA", () => {
    const store = createDeduplicationStore();
    store.seenSourceIds.add("abc123");

    const candidate = makeCandidate("c1", ["abc123"]);
    const result = isDuplicateCandidate(candidate, store);
    expect(result.isDuplicate).toBe(true);
    expect(result.reason).toContain("abc123");
  });

  it("detects duplicate release", () => {
    const store = createDeduplicationStore();
    store.seenSourceIds.add("release-v1.0.0");

    const candidate = makeCandidate("v1.0.0");
    candidate.source = "release";
    const result = isDuplicateCandidate(candidate, store);
    expect(result.isDuplicate).toBe(true);
    expect(result.reason).toContain("Release");
  });

  it("detects duplicate PR", () => {
    const store = createDeduplicationStore();
    store.seenSourceIds.add("pr-42");

    const candidate = makeCandidate("42");
    candidate.source = "pull-request";
    const result = isDuplicateCandidate(candidate, store);
    expect(result.isDuplicate).toBe(true);
    expect(result.reason).toContain("PR");
  });
});

describe("markAsSeen", () => {
  it("marks commit SHAs as seen", () => {
    const store = createDeduplicationStore();
    const candidate = makeCandidate("c1", ["abc123", "def456"]);

    markAsSeen(candidate, store);

    expect(store.seenSourceIds.has("abc123")).toBe(true);
    expect(store.seenSourceIds.has("def456")).toBe(true);
  });

  it("marks releases as seen", () => {
    const store = createDeduplicationStore();
    const candidate = makeCandidate("v1.0.0");
    candidate.source = "release";

    markAsSeen(candidate, store);

    expect(store.seenSourceIds.has("release-v1.0.0")).toBe(true);
  });

  it("marks PRs as seen", () => {
    const store = createDeduplicationStore();
    const candidate = makeCandidate("42");
    candidate.source = "pull-request";

    markAsSeen(candidate, store);

    expect(store.seenSourceIds.has("pr-42")).toBe(true);
  });

  it("marks content hash as seen", () => {
    const store = createDeduplicationStore();
    const candidate = makeCandidate("c1", [], "Unique title");

    markAsSeen(candidate, store);

    expect(store.seenContentHashes.size).toBe(1);
  });
});

describe("filterDuplicates", () => {
  it("returns all candidates as unique when store is empty", () => {
    const store = createDeduplicationStore();
    const candidates = [
      makeCandidate("c1", ["abc"], "First unique candidate"),
      makeCandidate("c2", ["def"], "Second unique candidate"),
    ];

    const { unique, duplicates } = filterDuplicates(candidates, store);
    expect(unique).toHaveLength(2);
    expect(duplicates).toHaveLength(0);
  });

  it("filters out duplicate candidates", () => {
    const store = createDeduplicationStore();
    store.seenSourceIds.add("abc123");

    const candidates = [
      makeCandidate("c1", ["abc123"]), // duplicate
      makeCandidate("c2", ["def456"]), // unique
    ];

    const { unique, duplicates } = filterDuplicates(candidates, store);
    expect(unique).toHaveLength(1);
    expect(duplicates).toHaveLength(1);
    expect(unique[0]?.id).toBe("c2");
  });

  it("marks new unique candidates as seen", () => {
    const store = createDeduplicationStore();
    const candidates = [makeCandidate("c1", ["abc123"])];

    filterDuplicates(candidates, store);

    expect(store.seenSourceIds.has("abc123")).toBe(true);
  });
});

describe("isDuplicateDraft", () => {
  it("returns not duplicate for new text", () => {
    const store = createDeduplicationStore();
    const result = isDuplicateDraft("Hello world", store);
    expect(result.isDuplicate).toBe(false);
  });

  it("detects identical draft", () => {
    const store = createDeduplicationStore();
    markDraftAsSeen("Hello world", store);

    const result = isDuplicateDraft("Hello world", store);
    expect(result.isDuplicate).toBe(true);
    expect(result.reason).toContain("Identical");
  });
});

describe("markDraftAsSeen", () => {
  it("marks draft as seen", () => {
    const store = createDeduplicationStore();
    markDraftAsSeen("Hello world", store);

    expect(store.seenContentHashes.size).toBe(1);
  });
});
