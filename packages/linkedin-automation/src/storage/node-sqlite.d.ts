// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Minimal type declarations for node:sqlite.
 *
 * The built-in node:sqlite module is not yet typed in @types/node.
 * This module re-exports the runtime values with safe type wrappers.
 */

declare module "node:sqlite" {
  interface RunResult {
    changes: number;
    lastInsertRowid: number;
  }

  class StatementSync {
    run(...params: unknown[]): RunResult;
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Record<string, unknown>[];
    iterate(...params: unknown[]): IterableIterator<Record<string, unknown>>;
  }

  class DatabaseSync {
    constructor(path: string, options?: { open?: boolean; readOnly?: boolean });
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
