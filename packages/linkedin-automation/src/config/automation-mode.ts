// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Automation mode determines how posts flow through the pipeline.
 *
 * In SAFE mode (default):
 *   Pipeline stops at REVIEW_REQUIRED.
 *   User must manually choose: Approve, Edit, Regenerate, Skip, Post Now, Schedule.
 *   No candidate may automatically publish.
 *
 * In FULL_AUTO mode (not implemented yet):
 *   Pipeline can auto-publish approved posts.
 */

/**
 * Available automation modes.
 */
export type AutomationMode = "safe" | "semi" | "full";

/**
 * All available modes as a const array.
 */
export const AUTOMATION_MODES: readonly AutomationMode[] = ["safe", "semi", "full"] as const;

/**
 * Default automation mode.
 */
export const DEFAULT_AUTOMATION_MODE: AutomationMode = "safe";

/**
 * Parse an automation mode from a string.
 *
 * @param value - The mode string from environment or config.
 * @returns The parsed mode, or undefined if invalid.
 */
export function parseAutomationMode(value: string | undefined): AutomationMode | undefined {
  if (value === undefined || value === "") {
    return DEFAULT_AUTOMATION_MODE;
  }

  const normalized = value.trim().toLowerCase();

  // Accept common aliases
  if (normalized === "safe" || normalized === "manual" || normalized === "review") {
    return "safe";
  }

  // Semi-auto: pipeline runs, posts are scheduled with approval window
  if (normalized === "semi" || normalized === "semi-auto" || normalized === "semiauto") {
    return "semi";
  }

  // Full-auto: pipeline runs end-to-end with safety checks
  if (normalized === "full" || normalized === "full-auto" || normalized === "fullauto" || normalized === "auto") {
    return "full";
  }

  return undefined;
}

/**
 * Load automation mode from environment.
 *
 * @param env - Environment object (defaults to process.env).
 * @returns The configured automation mode.
 */
export function loadAutomationMode(env?: Record<string, string | undefined>): AutomationMode {
  const environment = env ?? process.env;
  const raw = environment["AUTOMATION_MODE"];

  if (raw === undefined || raw === "") {
    return DEFAULT_AUTOMATION_MODE;
  }

  const mode = parseAutomationMode(raw);
  if (mode === undefined) {
    throw new Error(`Invalid AUTOMATION_MODE "${raw}". Valid modes: ${AUTOMATION_MODES.join(", ")}`);
  }

  return mode;
}

/**
 * Check if automatic publishing is allowed in the given mode.
 *
 * In SAFE mode, automatic publishing is never allowed.
 */
export function allowsAutoPublish(mode: AutomationMode): boolean {
  return mode === "semi" || mode === "full";
}

/**
 * Check if the pipeline should stop at REVIEW_REQUIRED in the given mode.
 *
 * In SAFE mode, the pipeline always stops for human review.
 * In SEMI mode, the pipeline continues but posts have an approval window.
 * In FULL mode, the pipeline continues unless safety checks fail.
 */
export function shouldStopAtReview(mode: AutomationMode): boolean {
  // SAFE mode always stops for human review
  if (mode === "safe") return true;
  // SEMI and FULL modes continue through the pipeline
  return false;
}
