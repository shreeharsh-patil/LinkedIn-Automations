// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";

import { normalizeContent, generateContentHash, generateCandidateHash, hashDistance } from "./content-hash.js";

describe("normalizeContent", () => {
  it("trims whitespace", () => {
    expect(normalizeContent("  hello  ")).toBe("hello");
  });

  it("collapses multiple spaces", () => {
    expect(normalizeContent("hello   world")).toBe("hello world");
  });

  it("normalizes line endings", () => {
    expect(normalizeContent("hello\r\nworld")).toBe("hello\nworld");
    expect(normalizeContent("hello\rworld")).toBe("hello\nworld");
  });

  it("removes zero-width characters", () => {
    expect(normalizeContent("hel\u200Blo")).toBe("hello");
    expect(normalizeContent("hel\u200Clo")).toBe("hello");
    expect(normalizeContent("hel\u200Dlo")).toBe("hello");
    expect(normalizeContent("hel\uFEFFlo")).toBe("hello");
  });

  it("lowercases text", () => {
    expect(normalizeContent("Hello World")).toBe("hello world");
  });

  it("normalizes hashtag spacing", () => {
    expect(normalizeContent("post#tag")).toBe("post #tag");
  });

  it("does not add space before hashtag at start of line", () => {
    expect(normalizeContent("#hello")).toBe("#hello");
  });

  it("collapses multiple newlines", () => {
    expect(normalizeContent("a\n\n\n\nb")).toBe("a\n\nb");
  });

  it("produces identical output for semantically same text", () => {
    const a = normalizeContent("  Hello   World  ");
    const b = normalizeContent("hello world");
    expect(a).toBe(b);
  });
});

describe("generateContentHash", () => {
  it("returns a 64-character hex string", () => {
    const hash = generateContentHash("test content");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic", () => {
    const hash1 = generateContentHash("hello world");
    const hash2 = generateContentHash("hello world");
    expect(hash1).toBe(hash2);
  });

  it("produces different hashes for different content", () => {
    const hash1 = generateContentHash("content A");
    const hash2 = generateContentHash("content B");
    expect(hash1).not.toBe(hash2);
  });

  it("produces same hash for semantically identical content", () => {
    const hash1 = generateContentHash("  Hello   World  ");
    const hash2 = generateContentHash("hello world");
    expect(hash1).toBe(hash2);
  });

  it("produces same hash regardless of whitespace differences", () => {
    const text1 = "Hello\n\n\nWorld";
    const text2 = "Hello\n\nWorld";
    expect(generateContentHash(text1)).toBe(generateContentHash(text2));
  });

  it("produces same hash for content with zero-width characters", () => {
    const text1 = "Hello\u200B World";
    const text2 = "Hello World";
    expect(generateContentHash(text1)).toBe(generateContentHash(text2));
  });
});

describe("generateCandidateHash", () => {
  it("returns a 64-character hex string", () => {
    const hash = generateCandidateHash("owner/repo", "commits", "title", ["fact1"]);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic", () => {
    const hash1 = generateCandidateHash("owner/repo", "commits", "title", ["fact1"]);
    const hash2 = generateCandidateHash("owner/repo", "commits", "title", ["fact1"]);
    expect(hash1).toBe(hash2);
  });

  it("produces different hashes for different repos", () => {
    const hash1 = generateCandidateHash("owner/repo-a", "commits", "title", ["fact1"]);
    const hash2 = generateCandidateHash("owner/repo-b", "commits", "title", ["fact1"]);
    expect(hash1).not.toBe(hash2);
  });

  it("produces different hashes for different titles", () => {
    const hash1 = generateCandidateHash("owner/repo", "commits", "title A", ["fact1"]);
    const hash2 = generateCandidateHash("owner/repo", "commits", "title B", ["fact1"]);
    expect(hash1).not.toBe(hash2);
  });

  it("produces different hashes for different facts", () => {
    const hash1 = generateCandidateHash("owner/repo", "commits", "title", ["fact1"]);
    const hash2 = generateCandidateHash("owner/repo", "commits", "title", ["fact2"]);
    expect(hash1).not.toBe(hash2);
  });

  it("is case-insensitive", () => {
    const hash1 = generateCandidateHash("Owner/Repo", "Commits", "Title", ["Fact1"]);
    const hash2 = generateCandidateHash("owner/repo", "commits", "title", ["fact1"]);
    expect(hash1).toBe(hash2);
  });
});

describe("hashDistance", () => {
  it("returns 0 for identical hashes", () => {
    const hash = generateContentHash("test");
    expect(hashDistance(hash, hash)).toBe(0);
  });

  it("returns 1 for completely different strings of same length", () => {
    expect(hashDistance("aaaa", "bbbb")).toBe(1);
  });

  it("returns values between 0 and 1", () => {
    const hash1 = generateContentHash("content A");
    const hash2 = generateContentHash("content B");
    const distance = hashDistance(hash1, hash2);
    expect(distance).toBeGreaterThan(0);
    expect(distance).toBeLessThan(1);
  });

  it("returns 1 for different length strings", () => {
    expect(hashDistance("short", "a much longer string")).toBe(1);
  });
});
