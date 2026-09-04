// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Configuration for the LinkedIn automation integration layer.
 *
 * All values are validated using Zod against environment variables with sensible defaults.
 */

import { validateAutomationEnv } from "./env-schema.js";
import type { AutomationMode } from "./automation-mode.js";

/**
 * Resolved configuration object.
 */
export interface AutomationConfig {
  /** Flow Agent HTTP base URL (e.g. `http://127.0.0.1:8001`). */
  flowAgentUrl: string;
  /** LinkedIn profile name to use from linkedctl config. */
  linkedinProfile: string | undefined;
  /** Timeout in milliseconds for Flow Agent image generation requests. */
  flowGenerationTimeoutMs: number;
  /** Timeout in milliseconds for Flow Agent health checks. */
  flowHealthTimeoutMs: number;
  /** Automation mode (default: "safe"). */
  automationMode: AutomationMode;
  /** Approval window in hours for semi-auto mode (default: 24). */
  approvalWindowHours: number;
  /** Safe review dry run mode. If true, all steps execute except LinkedIn publishing. */
  dryRun: boolean;
  /** Custom SQLite database path. */
  databasePath?: string | undefined;
}

/**
 * Configuration error thrown when environment variables are missing or have invalid values.
 */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

/**
 * Load and validate configuration from environment variables.
 */
export function loadConfig(env?: Record<string, string | undefined>): AutomationConfig {
  try {
    const validated = validateAutomationEnv(env ?? process.env);
    return {
      flowAgentUrl: validated.FLOW_AGENT_URL,
      linkedinProfile: validated.LINKEDCTL_PROFILE,
      flowGenerationTimeoutMs: validated.FLOW_GENERATION_TIMEOUT_MS,
      flowHealthTimeoutMs: validated.FLOW_HEALTH_TIMEOUT_MS,
      automationMode: validated.AUTOMATION_MODE,
      approvalWindowHours: validated.APPROVAL_WINDOW_HOURS,
      dryRun: validated.DRY_RUN,
      databasePath: validated.DATABASE_PATH,
    };
  } catch (err: unknown) {
    if (err instanceof Error) {
      throw new ConfigurationError(err.message);
    }
    throw new ConfigurationError("Unknown configuration error");
  }
}
