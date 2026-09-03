// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

// Types
export { POST_STATES, VALID_TRANSITIONS, isValidTransition, DEFAULT_SETTINGS } from "./types.js";
export type {
  PostState,
  ContentCandidateRecord,
  PostDraftRecord,
  ScheduledPostRecord,
  PublishedPostRecord,
  AutomationSettingsRecord,
} from "./types.js";

// Storage interface
export type { StoragePort } from "./storage.js";

// SQLite implementation
export { SqliteStorage } from "./sqlite-storage.js";

// Content hashing
export { normalizeContent, generateContentHash, generateCandidateHash, hashDistance } from "./content-hash.js";

// Idempotent publisher
export { IdempotentPublisher } from "./idempotent-publisher.js";
export type { IdempotentPublishResult } from "./idempotent-publisher.js";
