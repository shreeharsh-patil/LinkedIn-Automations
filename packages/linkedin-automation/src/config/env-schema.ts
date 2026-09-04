// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { z } from "zod";
import { AUTOMATION_MODES, type AutomationMode } from "./automation-mode.js";

/**
 * Zod schema for LinkedIn Automation environment configuration.
 */
export const AutomationEnvSchema = z.object({
  FLOW_AGENT_URL: z
    .string()
    .url("Invalid Flow Agent URL")
    .default("http://127.0.0.1:8001")
    .transform((url) => url.replace(/\/+$/, "")),

  LINKEDCTL_PROFILE: z.string().trim().min(1).optional(),

  FLOW_GENERATION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive("FLOW_GENERATION_TIMEOUT_MS must be a positive integer")
    .default(300_000),

  FLOW_HEALTH_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive("FLOW_HEALTH_TIMEOUT_MS must be a positive integer")
    .default(5_000),

  AUTOMATION_MODE: z
    .enum(AUTOMATION_MODES as unknown as [string, ...string[]])
    .default("safe")
    .transform((v) => v as AutomationMode),

  APPROVAL_WINDOW_HOURS: z.coerce
    .number()
    .int()
    .positive("APPROVAL_WINDOW_HOURS must be a positive integer")
    .default(24),

  DRY_RUN: z
    .enum(["true", "false", "1", "0", ""])
    .optional()
    .transform((v) => v === "true" || v === "1"),

  DATABASE_PATH: z.string().trim().min(1).optional(),
});

export type ValidatedAutomationEnv = z.infer<typeof AutomationEnvSchema>;

/**
 * Validates environment variables and throws clean, actionable human-readable errors.
 */
export function validateAutomationEnv(env: Record<string, string | undefined> = process.env): ValidatedAutomationEnv {
  const result = AutomationEnvSchema.safeParse(env);
  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`[ConfigurationError] Invalid environment configuration:\n${formatted}`);
  }
  return result.data;
}
