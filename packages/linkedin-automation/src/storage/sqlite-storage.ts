// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * SQLite-backed implementation of StoragePort.
 *
 * Uses the built-in `node:sqlite` module (available since Node.js 22.5).
 * The database file is created automatically on first use.
 *
 * Provides transactional schema migrations, atomic job claiming,
 * retry state tracking, and media attachment persistence.
 */

import { DatabaseSync } from "node:sqlite";

import type { StoragePort } from "./storage.js";
import type {
  AutomationSettingsRecord,
  ContentCandidateRecord,
  PostDraftRecord,
  PostState,
  PublishedPostRecord,
  ScheduledPostRecord,
} from "./types.js";
import { DEFAULT_SETTINGS } from "./types.js";

/**
 * SQLite storage implementation.
 */
export class SqliteStorage implements StoragePort {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec("PRAGMA foreign_keys=ON");
  }

  /** Initialize the database schema and apply incremental migrations. Safe to call multiple times. */
  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS content_candidates (
        id TEXT PRIMARY KEY,
        repo TEXT NOT NULL,
        source TEXT NOT NULL,
        score REAL NOT NULL,
        title TEXT NOT NULL,
        facts TEXT NOT NULL DEFAULT '[]',
        reason TEXT NOT NULL DEFAULT '',
        supporting_commits TEXT NOT NULL DEFAULT '[]',
        supporting_files TEXT NOT NULL DEFAULT '[]',
        state TEXT NOT NULL DEFAULT 'DISCOVERED',
        content_hash TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS seen_source_ids (
        source_id TEXT PRIMARY KEY
      );

      CREATE TABLE IF NOT EXISTS post_drafts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate_id TEXT NOT NULL,
        text TEXT NOT NULL DEFAULT '',
        word_count INTEGER NOT NULL DEFAULT 0,
        facts_used TEXT NOT NULL DEFAULT '[]',
        slop_score INTEGER NOT NULL DEFAULT 0,
        verification_summary TEXT NOT NULL DEFAULT '',
        review_decision TEXT NOT NULL DEFAULT '',
        review_score INTEGER NOT NULL DEFAULT 0,
        suggestions TEXT NOT NULL DEFAULT '[]',
        image_path TEXT DEFAULT '',
        media_urn TEXT DEFAULT '',
        state TEXT NOT NULL DEFAULT 'DRAFT',
        content_hash TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS scheduled_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        draft_id INTEGER NOT NULL,
        scheduled_at TEXT NOT NULL,
        lock_id TEXT,
        lock_expires_at TEXT,
        state TEXT NOT NULL DEFAULT 'SCHEDULED',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT DEFAULT '',
        idempotency_key TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS published_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        draft_id INTEGER NOT NULL,
        linkedin_post_id TEXT NOT NULL,
        linkedin_post_urn TEXT NOT NULL,
        linkedin_post_url TEXT NOT NULL DEFAULT '',
        content_hash TEXT NOT NULL,
        idempotency_key TEXT DEFAULT '',
        published_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS automation_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        lookback_days INTEGER NOT NULL DEFAULT 7,
        score_threshold INTEGER NOT NULL DEFAULT 5,
        max_words INTEGER NOT NULL DEFAULT 300,
        include_hashtags INTEGER NOT NULL DEFAULT 1,
        min_post_interval_ms INTEGER NOT NULL DEFAULT 3600000,
        automation_mode TEXT NOT NULL DEFAULT 'safe',
        approval_window_hours INTEGER NOT NULL DEFAULT 24,
        updated_at TEXT NOT NULL
      );
    `);

    // Run migrations for existing databases that were created before these columns were added
    this.runMigrations();
  }

  private runMigrations(): void {
    try {
      const draftCols = this.getTableColumns("post_drafts");
      if (!draftCols.has("image_path")) {
        this.db.exec("ALTER TABLE post_drafts ADD COLUMN image_path TEXT DEFAULT ''");
      }
      if (!draftCols.has("media_urn")) {
        this.db.exec("ALTER TABLE post_drafts ADD COLUMN media_urn TEXT DEFAULT ''");
      }

      const scheduledCols = this.getTableColumns("scheduled_posts");
      if (!scheduledCols.has("attempts")) {
        this.db.exec("ALTER TABLE scheduled_posts ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0");
      }
      if (!scheduledCols.has("last_error")) {
        this.db.exec("ALTER TABLE scheduled_posts ADD COLUMN last_error TEXT DEFAULT ''");
      }
      if (!scheduledCols.has("idempotency_key")) {
        this.db.exec("ALTER TABLE scheduled_posts ADD COLUMN idempotency_key TEXT DEFAULT ''");
      }

      const publishedCols = this.getTableColumns("published_posts");
      if (!publishedCols.has("idempotency_key")) {
        this.db.exec("ALTER TABLE published_posts ADD COLUMN idempotency_key TEXT DEFAULT ''");
      }
    } catch {
      // Columns may already exist or table is fresh
    }
  }

  private getTableColumns(tableName: string): Set<string> {
    const stmt = this.db.prepare(`PRAGMA table_info(${tableName})`);
    const rows = stmt.all() as Array<{ name: string }>;
    return new Set(rows.map((r) => r.name));
  }

  /** Close the database connection. */
  close(): void {
    this.db.close();
  }

  // ─── Content Candidates ──────────────────────────────────────

  insertCandidate(candidate: ContentCandidateRecord): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO content_candidates
        (id, repo, source, score, title, facts, reason,
         supporting_commits, supporting_files, state, content_hash,
         created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      candidate.id,
      candidate.repo,
      candidate.source,
      candidate.score,
      candidate.title,
      JSON.stringify(candidate.facts),
      candidate.reason,
      JSON.stringify(candidate.supportingCommits),
      JSON.stringify(candidate.supportingFiles),
      candidate.state,
      candidate.contentHash,
      candidate.createdAt,
      candidate.updatedAt,
    );
  }

  getCandidate(id: string): ContentCandidateRecord | undefined {
    const stmt = this.db.prepare("SELECT * FROM content_candidates WHERE id = ?");
    const row = stmt.get(id);
    if (row === undefined) return undefined;
    return this.hydrateCandidate(row);
  }

  updateCandidateState(id: string, state: PostState): void {
    const stmt = this.db.prepare("UPDATE content_candidates SET state = ?, updated_at = ? WHERE id = ?");
    stmt.run(state, new Date().toISOString(), id);
  }

  getCandidatesByState(state: PostState): ContentCandidateRecord[] {
    const stmt = this.db.prepare("SELECT * FROM content_candidates WHERE state = ? ORDER BY created_at");
    return stmt.all(state).map((row) => this.hydrateCandidate(row));
  }

  getAllCandidates(): ContentCandidateRecord[] {
    const stmt = this.db.prepare("SELECT * FROM content_candidates ORDER BY created_at");
    return stmt.all().map((row) => this.hydrateCandidate(row));
  }

  candidateExistsByHash(contentHash: string): boolean {
    const stmt = this.db.prepare("SELECT 1 FROM content_candidates WHERE content_hash = ? LIMIT 1");
    return stmt.get(contentHash) !== undefined;
  }

  sourceIdExists(sourceId: string): boolean {
    const stmt = this.db.prepare("SELECT 1 FROM seen_source_ids WHERE source_id = ? LIMIT 1");
    return stmt.get(sourceId) !== undefined;
  }

  recordSourceId(sourceId: string): void {
    const stmt = this.db.prepare("INSERT OR IGNORE INTO seen_source_ids (source_id) VALUES (?)");
    stmt.run(sourceId);
  }

  // ─── Post Drafts ─────────────────────────────────────────────

  insertDraft(draft: Omit<PostDraftRecord, "id">): number {
    const stmt = this.db.prepare(`
      INSERT INTO post_drafts
        (candidate_id, text, word_count, facts_used, slop_score,
         verification_summary, review_decision, review_score, suggestions,
         image_path, media_urn, state, content_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      draft.candidateId,
      draft.text,
      draft.wordCount,
      JSON.stringify(draft.factsUsed),
      draft.slopScore,
      draft.verificationSummary,
      draft.reviewDecision,
      draft.reviewScore,
      JSON.stringify(draft.suggestions),
      draft.imagePath ?? "",
      draft.mediaUrn ?? "",
      draft.state,
      draft.contentHash,
      draft.createdAt,
      draft.updatedAt,
    );
    return result.lastInsertRowid;
  }

  getDraft(id: number): PostDraftRecord | undefined {
    const stmt = this.db.prepare("SELECT * FROM post_drafts WHERE id = ?");
    const row = stmt.get(id);
    if (row === undefined) return undefined;
    return this.hydrateDraft(row);
  }

  updateDraftState(id: number, state: PostState): void {
    const stmt = this.db.prepare("UPDATE post_drafts SET state = ?, updated_at = ? WHERE id = ?");
    stmt.run(state, new Date().toISOString(), id);
  }

  updateDraftText(id: number, text: string, wordCount: number, contentHash: string): void {
    const stmt = this.db.prepare(
      "UPDATE post_drafts SET text = ?, word_count = ?, content_hash = ?, state = 'REVIEW_REQUIRED', updated_at = ? WHERE id = ?",
    );
    stmt.run(text, wordCount, contentHash, new Date().toISOString(), id);
  }

  updateDraftMedia(id: number, imagePath?: string, mediaUrn?: string): void {
    const stmt = this.db.prepare("UPDATE post_drafts SET image_path = ?, media_urn = ?, updated_at = ? WHERE id = ?");
    stmt.run(imagePath ?? "", mediaUrn ?? "", new Date().toISOString(), id);
  }

  getDraftsByState(state: PostState): PostDraftRecord[] {
    const stmt = this.db.prepare("SELECT * FROM post_drafts WHERE state = ? ORDER BY created_at");
    return stmt.all(state).map((row) => this.hydrateDraft(row));
  }

  getAllDrafts(): PostDraftRecord[] {
    const stmt = this.db.prepare("SELECT * FROM post_drafts ORDER BY created_at");
    return stmt.all().map((row) => this.hydrateDraft(row));
  }

  draftExistsByHash(contentHash: string): boolean {
    const stmt = this.db.prepare("SELECT 1 FROM post_drafts WHERE content_hash = ? LIMIT 1");
    return stmt.get(contentHash) !== undefined;
  }

  // ─── Scheduled Posts ─────────────────────────────────────────

  insertScheduledPost(post: Omit<ScheduledPostRecord, "id" | "attempts"> & { attempts?: number }): number {
    const stmt = this.db.prepare(`
      INSERT INTO scheduled_posts
        (draft_id, scheduled_at, lock_id, lock_expires_at, state, attempts, last_error, idempotency_key, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      post.draftId,
      post.scheduledAt,
      post.lockId ?? null,
      post.lockExpiresAt ?? null,
      post.state,
      post.attempts ?? 0,
      post.lastError ?? "",
      post.idempotencyKey ?? "",
      post.createdAt,
      post.updatedAt,
    );
    return result.lastInsertRowid;
  }

  getScheduledPost(id: number): ScheduledPostRecord | undefined {
    const stmt = this.db.prepare("SELECT * FROM scheduled_posts WHERE id = ?");
    const row = stmt.get(id);
    if (row === undefined) return undefined;
    return this.hydrateScheduledPost(row);
  }

  updateScheduledPostState(id: number, state: PostState): void {
    const stmt = this.db.prepare("UPDATE scheduled_posts SET state = ?, updated_at = ? WHERE id = ?");
    stmt.run(state, new Date().toISOString(), id);
  }

  updateScheduledPostAttempt(id: number, attempts: number, lastError?: string): void {
    const stmt = this.db.prepare(`
      UPDATE scheduled_posts
      SET attempts = ?, last_error = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(attempts, lastError ?? "", new Date().toISOString(), id);
  }

  acquirePublishLock(id: number, lockId: string, lockDurationMs: number): string | undefined {
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + lockDurationMs).toISOString();

    const stmt = this.db.prepare(`
      UPDATE scheduled_posts
      SET lock_id = ?, lock_expires_at = ?, updated_at = ?
      WHERE id = ?
        AND (state = 'SCHEDULED' OR state = 'PROCESSING')
        AND (lock_id IS NULL OR lock_expires_at < ?)
    `);
    const result = stmt.run(lockId, expiresAt, now, id, now);

    if (result.changes === 0) {
      return undefined;
    }
    return lockId;
  }

  releasePublishLock(id: number, lockId: string): void {
    const stmt = this.db.prepare(`
      UPDATE scheduled_posts
      SET lock_id = NULL, lock_expires_at = NULL, updated_at = ?
      WHERE id = ? AND lock_id = ?
    `);
    stmt.run(new Date().toISOString(), id, lockId);
  }

  getNextScheduledPost(): ScheduledPostRecord | undefined {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      SELECT * FROM scheduled_posts
      WHERE state = 'SCHEDULED'
        AND (lock_id IS NULL OR lock_expires_at < ?)
        AND scheduled_at <= ?
      ORDER BY scheduled_at
      LIMIT 1
    `);
    const row = stmt.get(now, now);
    if (row === undefined) return undefined;
    return this.hydrateScheduledPost(row);
  }

  /**
   * Atomically claim and lock the next due scheduled post in a single transaction.
   * Guaranteed to prevent race conditions when multiple worker processes are running.
   */
  claimNextScheduledPost(lockId: string, lockDurationMs: number): ScheduledPostRecord | undefined {
    const now = new Date();
    const nowIso = now.toISOString();
    const expiresIso = new Date(now.getTime() + lockDurationMs).toISOString();

    this.db.exec("BEGIN IMMEDIATE");
    try {
      const selectStmt = this.db.prepare(`
        SELECT id FROM scheduled_posts
        WHERE state = 'SCHEDULED'
          AND (lock_id IS NULL OR lock_expires_at < ?)
          AND scheduled_at <= ?
        ORDER BY scheduled_at
        LIMIT 1
      `);
      const row = selectStmt.get(nowIso, nowIso) as { id: number } | undefined;
      if (!row) {
        this.db.exec("COMMIT");
        return undefined;
      }

      const updateStmt = this.db.prepare(`
        UPDATE scheduled_posts
        SET lock_id = ?, lock_expires_at = ?, state = 'PROCESSING', updated_at = ?
        WHERE id = ? AND state = 'SCHEDULED'
      `);
      const result = updateStmt.run(lockId, expiresIso, nowIso, row.id);
      this.db.exec("COMMIT");

      if (result.changes === 0) {
        return undefined;
      }

      return this.getScheduledPost(row.id);
    } catch (err) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // ignore rollback errors if transaction was closed
      }
      throw err;
    }
  }

  // ─── Published Posts ─────────────────────────────────────────

  insertPublishedPost(post: Omit<PublishedPostRecord, "id">): number {
    const stmt = this.db.prepare(`
      INSERT INTO published_posts
        (draft_id, linkedin_post_id, linkedin_post_urn, linkedin_post_url,
         content_hash, idempotency_key, published_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      post.draftId,
      post.linkedinPostId,
      post.linkedinPostUrn,
      post.linkedinPostUrl,
      post.contentHash,
      post.idempotencyKey ?? "",
      post.publishedAt,
      post.createdAt,
    );
    return result.lastInsertRowid;
  }

  getAllPublishedPosts(): PublishedPostRecord[] {
    const stmt = this.db.prepare("SELECT * FROM published_posts ORDER BY published_at DESC");
    return stmt.all().map((row) => this.hydratePublishedPost(row));
  }

  publishedPostExistsByHash(contentHash: string): boolean {
    const stmt = this.db.prepare("SELECT 1 FROM published_posts WHERE content_hash = ? LIMIT 1");
    return stmt.get(contentHash) !== undefined;
  }

  publishedPostExistsByIdempotencyKey(key: string): boolean {
    if (!key || key.trim() === "") return false;
    const stmt = this.db.prepare("SELECT 1 FROM published_posts WHERE idempotency_key = ? LIMIT 1");
    return stmt.get(key) !== undefined;
  }

  getPublishedPostByUrn(urn: string): PublishedPostRecord | undefined {
    const stmt = this.db.prepare("SELECT * FROM published_posts WHERE linkedin_post_urn = ?");
    const row = stmt.get(urn);
    if (row === undefined) return undefined;
    return this.hydratePublishedPost(row);
  }

  // ─── Automation Settings ─────────────────────────────────────

  getSettings(): AutomationSettingsRecord {
    const stmt = this.db.prepare("SELECT * FROM automation_settings WHERE id = 1");
    const row = stmt.get();
    if (row === undefined) {
      const now = new Date().toISOString();
      const insert = this.db.prepare(`
        INSERT OR IGNORE INTO automation_settings
          (id, lookback_days, score_threshold, max_words, include_hashtags,
           min_post_interval_ms, automation_mode, approval_window_hours, updated_at)
        VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insert.run(
        DEFAULT_SETTINGS.lookbackDays,
        DEFAULT_SETTINGS.scoreThreshold,
        DEFAULT_SETTINGS.maxWords,
        DEFAULT_SETTINGS.includeHashtags ? 1 : 0,
        DEFAULT_SETTINGS.minPostIntervalMs,
        DEFAULT_SETTINGS.automationMode,
        DEFAULT_SETTINGS.approvalWindowHours,
        now,
      );
      return {
        id: 1,
        ...DEFAULT_SETTINGS,
        updatedAt: now,
      };
    }
    return this.hydrateSettings(row);
  }

  updateSettings(settings: Omit<AutomationSettingsRecord, "id" | "updatedAt">): void {
    this.getSettings();

    const stmt = this.db.prepare(`
      UPDATE automation_settings
      SET lookback_days = ?, score_threshold = ?, max_words = ?,
          include_hashtags = ?, min_post_interval_ms = ?,
          automation_mode = ?, approval_window_hours = ?, updated_at = ?
      WHERE id = 1
    `);
    stmt.run(
      settings.lookbackDays,
      settings.scoreThreshold,
      settings.maxWords,
      settings.includeHashtags ? 1 : 0,
      settings.minPostIntervalMs,
      settings.automationMode,
      settings.approvalWindowHours,
      new Date().toISOString(),
    );
  }

  // ─── Hydration helpers ───────────────────────────────────────

  private hydrateCandidate(row: Record<string, unknown>): ContentCandidateRecord {
    return {
      id: String(row["id"]),
      repo: String(row["repo"]),
      source: String(row["source"]) as ContentCandidateRecord["source"],
      score: Number(row["score"]),
      title: String(row["title"]),
      facts: JSON.parse(String(row["facts"])) as string[],
      reason: String(row["reason"]),
      supportingCommits: JSON.parse(String(row["supporting_commits"])) as string[],
      supportingFiles: JSON.parse(String(row["supporting_files"])) as string[],
      state: String(row["state"]) as PostState,
      contentHash: String(row["content_hash"]),
      createdAt: String(row["created_at"]),
      updatedAt: String(row["updated_at"]),
    };
  }

  private hydrateDraft(row: Record<string, unknown>): PostDraftRecord {
    return {
      id: Number(row["id"]),
      candidateId: String(row["candidate_id"]),
      text: String(row["text"]),
      wordCount: Number(row["word_count"]),
      factsUsed: JSON.parse(String(row["facts_used"])) as string[],
      slopScore: Number(row["slop_score"]),
      verificationSummary: String(row["verification_summary"]),
      reviewDecision: String(row["review_decision"]),
      reviewScore: Number(row["review_score"]),
      suggestions: JSON.parse(String(row["suggestions"])) as string[],
      imagePath: typeof row["image_path"] === "string" && row["image_path"] ? row["image_path"] : undefined,
      mediaUrn: typeof row["media_urn"] === "string" && row["media_urn"] ? row["media_urn"] : undefined,
      state: String(row["state"]) as PostState,
      contentHash: String(row["content_hash"]),
      createdAt: String(row["created_at"]),
      updatedAt: String(row["updated_at"]),
    };
  }

  private hydrateScheduledPost(row: Record<string, unknown>): ScheduledPostRecord {
    return {
      id: Number(row["id"]),
      draftId: Number(row["draft_id"]),
      scheduledAt: String(row["scheduled_at"]),
      lockId: typeof row["lock_id"] === "string" ? row["lock_id"] : undefined,
      lockExpiresAt: typeof row["lock_expires_at"] === "string" ? row["lock_expires_at"] : undefined,
      state: String(row["state"]) as PostState,
      attempts: Number(row["attempts"] ?? 0),
      lastError: typeof row["last_error"] === "string" && row["last_error"] ? row["last_error"] : undefined,
      idempotencyKey: typeof row["idempotency_key"] === "string" && row["idempotency_key"] ? row["idempotency_key"] : undefined,
      createdAt: String(row["created_at"]),
      updatedAt: String(row["updated_at"]),
    };
  }

  private hydratePublishedPost(row: Record<string, unknown>): PublishedPostRecord {
    return {
      id: Number(row["id"]),
      draftId: Number(row["draft_id"]),
      linkedinPostId: String(row["linkedin_post_id"]),
      linkedinPostUrn: String(row["linkedin_post_urn"]),
      linkedinPostUrl: String(row["linkedin_post_url"]),
      contentHash: String(row["content_hash"]),
      idempotencyKey: typeof row["idempotency_key"] === "string" && row["idempotency_key"] ? row["idempotency_key"] : undefined,
      publishedAt: String(row["published_at"]),
      createdAt: String(row["created_at"]),
    };
  }

  private hydrateSettings(row: Record<string, unknown>): AutomationSettingsRecord {
    return {
      id: Number(row["id"]),
      lookbackDays: Number(row["lookback_days"]),
      scoreThreshold: Number(row["score_threshold"]),
      maxWords: Number(row["max_words"]),
      includeHashtags: Number(row["include_hashtags"]) === 1,
      minPostIntervalMs: Number(row["min_post_interval_ms"]),
      automationMode: String(row["automation_mode"]),
      approvalWindowHours: Number(row["approval_window_hours"]),
      updatedAt: String(row["updated_at"]),
    };
  }
}
