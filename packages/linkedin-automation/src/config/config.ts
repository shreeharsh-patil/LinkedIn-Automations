// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Configuration for the LinkedIn automation integration layer.
 *
 * All values are resolved from environment variables with sensible defaults.
 */

/**
 * Resolved configuration object.
 */
import { loadAutomationMode, type AutomationMode } from "./automation-mode.js";

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
}

/**
 * Default configuration values.
 */
const DEFAULTS = {
  flowAgentUrl: "http://127.0.0.1:8001",
  flowGenerationTimeoutMs: 300_000,
  flowHealthTimeoutMs: 5_000,
} as const;

/**
 * Configuration error thrown when required environment variables are missing
 * or have invalid values.
 */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

/**
 * Load and validate configuration from environment variables.
 *
 * Environment variables:
 * - `FLOW_AGENT_URL` — Flow Agent base URL (default: `http://127.0.0.1:8001`)
 * - `LINKEDCTL_PROFILE` — LinkedIn profile name (default: undefined)
 * - `FLOW_GENERATION_TIMEOUT_MS` — Image generation timeout (default: `300000`)
 * - `FLOW_HEALTH_TIMEOUT_MS` — Health check timeout (default: `5000`)
 */
export function loadConfig(env?: Record<string, string | undefined>): AutomationConfig {
  const environment = env ?? process.env;

  const flowAgentUrl = normalizeUrl(environment["FLOW_AGENT_URL"] ?? DEFAULTS.flowAgentUrl);
  const linkedinProfile = environment["LINKEDCTL_PROFILE"] ?? undefined;

  const flowGenerationTimeoutMs = parsePositiveInt(
    environment["FLOW_GENERATION_TIMEOUT_MS"],
    DEFAULTS.flowGenerationTimeoutMs,
    "FLOW_GENERATION_TIMEOUT_MS",
  );
  const flowHealthTimeoutMs = parsePositiveInt(
    environment["FLOW_HEALTH_TIMEOUT_MS"],
    DEFAULTS.flowHealthTimeoutMs,
    "FLOW_HEALTH_TIMEOUT_MS",
  );

  const automationMode = loadAutomationMode(environment);

  const approvalWindowHours = parsePositiveInt(environment["APPROVAL_WINDOW_HOURS"], 24, "APPROVAL_WINDOW_HOURS");

  return {
    flowAgentUrl,
    linkedinProfile,
    flowGenerationTimeoutMs,
    flowHealthTimeoutMs,
    automationMode,
    approvalWindowHours,
  };
}

/**
 * Normalize a URL by stripping trailing slashes.
 */
function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed === "") {
    throw new ConfigurationError("Flow Agent URL cannot be empty");
  }
  try {
    new URL(trimmed);
  } catch {
    throw new ConfigurationError(`Invalid Flow Agent URL: "${trimmed}"`);
  }
  return trimmed.replace(/\/+$/, "");
}

/**
 * Parse a positive integer from a string, falling back to a default.
 */
function parsePositiveInt(value: string | undefined, defaultValue: number, name: string): number {
  if (value === undefined || value === "") {
    return defaultValue;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new ConfigurationError(`${name} must be a positive integer, got "${value}"`);
  }
  return parsed;
}
