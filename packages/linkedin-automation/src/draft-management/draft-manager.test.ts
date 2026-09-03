// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { SqliteStorage } from "../storage/sqlite-storage.js";
import { generateContentHash } from "../storage/content-hash.js";
import { listDrafts, viewDraft, approveDraft, editDraft, rejectDraft, postNow } from "./draft-manager.js";
import type { PostDraftRecord } from "../storage/types.js";

let storage: SqliteStorage;
let tempDir: string;

function makeDraft(candidateId: string, overrides?: Partial<PostDraftRecord>): Omit<PostDraftRecord, "id"> {
  return {
    candidateId,
    text: `Draft text for ${candidateId}`,
    wordCount: 10,
    factsUsed: ["fact-1"],
    slopScore: 5,
    verificationSummary: "1 supported",
    reviewDecision: "APPROVED",
    reviewScore: 85,
    suggestions: [],
    state: "REVIEW_REQUIRED",
    contentHash: generateContentHash(`Draft text for ${candidateId}`),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "draft-mgmt-test-"));
  storage = new SqliteStorage(join(tempDir, "test.db"));
  storage.initialize();
});

afterEach(() => {
  storage.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("listDrafts", () => {
  it("returns empty array when no drafts exist", () => {
    const drafts = listDrafts(storage);
    expect(drafts).toHaveLength(0);
  });

  it("lists all drafts", () => {
    storage.insertDraft(makeDraft("c1"));
    storage.insertDraft(makeDraft("c2"));

    const drafts = listDrafts(storage);
    expect(drafts).toHaveLength(2);
  });

  it("filters by state", () => {
    storage.insertDraft(makeDraft("c1", { state: "REVIEW_REQUIRED" }));
    storage.insertDraft(makeDraft("c2", { state: "APPROVED" }));
    storage.insertDraft(makeDraft("c3", { state: "REVIEW_REQUIRED" }));

    const drafts = listDrafts(storage, "REVIEW_REQUIRED");
    expect(drafts).toHaveLength(2);
  });

  it("truncates long text in preview", () => {
    const longText = "A".repeat(100);
    storage.insertDraft(makeDraft("c1", { text: longText }));

    const drafts = listDrafts(storage);
    expect(drafts[0]?.preview.length).toBeLessThanOrEqual(80);
    expect(drafts[0]?.preview).toContain("...");
  });
});

describe("viewDraft", () => {
  it("returns undefined for non-existent draft", () => {
    expect(viewDraft(storage, 999)).toBeUndefined();
  });

  it("returns draft details", () => {
    const draftId = storage.insertDraft(makeDraft("c1"));

    const details = viewDraft(storage, draftId);
    expect(details).toBeDefined();
    expect(details?.draft.id).toBe(draftId);
  });
});

describe("approveDraft", () => {
  it("approves a REVIEW_REQUIRED draft", () => {
    const draftId = storage.insertDraft(makeDraft("c1"));

    const result = approveDraft(storage, draftId);

    expect(result.success).toBe(true);
    expect(result.newState).toBe("APPROVED");
    expect(storage.getDraft(draftId)?.state).toBe("APPROVED");
  });

  it("fails for non-existent draft", () => {
    const result = approveDraft(storage, 999);
    expect(result.success).toBe(false);
    expect(result.message).toContain("not found");
  });

  it("fails for non-REVIEW_REQUIRED draft", () => {
    const draftId = storage.insertDraft(makeDraft("c1", { state: "APPROVED" }));

    const result = approveDraft(storage, draftId);
    expect(result.success).toBe(false);
    expect(result.message).toContain("APPROVED");
  });
});

describe("editDraft", () => {
  it("edits a draft's text", () => {
    const draftId = storage.insertDraft(makeDraft("c1"));

    const result = editDraft(storage, draftId, "Updated text content");

    expect(result.success).toBe(true);
    expect(result.newState).toBe("REVIEW_REQUIRED");

    const updated = storage.getDraft(draftId);
    expect(updated?.text).toBe("Updated text content");
  });

  it("fails for non-existent draft", () => {
    const result = editDraft(storage, 999, "New text");
    expect(result.success).toBe(false);
  });

  it("fails for empty text", () => {
    const draftId = storage.insertDraft(makeDraft("c1"));

    const result = editDraft(storage, draftId, "");
    expect(result.success).toBe(false);
    expect(result.message).toContain("empty");
  });
});

describe("rejectDraft", () => {
  it("rejects a REVIEW_REQUIRED draft", () => {
    const draftId = storage.insertDraft(makeDraft("c1"));

    const result = rejectDraft(storage, draftId);

    expect(result.success).toBe(true);
    expect(result.newState).toBe("SKIPPED");
    expect(storage.getDraft(draftId)?.state).toBe("SKIPPED");
  });

  it("rejects an APPROVED draft", () => {
    const draftId = storage.insertDraft(makeDraft("c1", { state: "APPROVED" }));

    const result = rejectDraft(storage, draftId);

    expect(result.success).toBe(true);
    expect(result.newState).toBe("SKIPPED");
  });

  it("fails for non-existent draft", () => {
    const result = rejectDraft(storage, 999);
    expect(result.success).toBe(false);
  });

  it("fails for DRAFT state", () => {
    const draftId = storage.insertDraft(makeDraft("c1", { state: "DRAFT" }));

    const result = rejectDraft(storage, draftId);
    expect(result.success).toBe(false);
  });
});

describe("postNow", () => {
  it("creates immediate schedule for APPROVED draft", () => {
    const draftId = storage.insertDraft(makeDraft("c1", { state: "APPROVED" }));

    const result = postNow(storage, draftId);

    expect(result.success).toBe(true);
    expect(result.newState).toBe("SCHEDULED");
    expect(storage.getDraft(draftId)?.state).toBe("SCHEDULED");
  });

  it("fails for non-existent draft", () => {
    const result = postNow(storage, 999);
    expect(result.success).toBe(false);
  });

  it("fails for non-APPROVED draft", () => {
    const draftId = storage.insertDraft(makeDraft("c1", { state: "REVIEW_REQUIRED" }));

    const result = postNow(storage, draftId);
    expect(result.success).toBe(false);
    expect(result.message).toContain("APPROVED");
  });
});
