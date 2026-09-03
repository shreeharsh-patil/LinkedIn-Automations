// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Failure classification for LinkedIn publish errors.
 *
 * Errors are classified into categories that determine retry behavior:
 * - Retryable: RATE_LIMIT, NETWORK_ERROR (safe to retry with backoff)
 * - Non-retryable: AUTH_ERROR, INVALID_MEDIA, FLOW_AGENT_ERROR, LINKEDIN_REJECTED
 * - Unknown: requires manual inspection
 */

/**
 * Failure categories.
 */
export type FailureCategory =
  | "AUTH_ERROR"
  | "RATE_LIMIT"
  | "NETWORK_ERROR"
  | "INVALID_MEDIA"
  | "FLOW_AGENT_ERROR"
  | "LINKEDIN_REJECTED"
  | "UNKNOWN";

/**
 * Classified failure result.
 */
export interface ClassifiedFailure {
  /** The failure category. */
  category: FailureCategory;
  /** Whether this failure is safe to retry. */
  retryable: boolean;
  /** Original error message. */
  message: string;
}

/**
 * Pattern-based classification rules.
 *
 * Order matters — first match wins.
 */
const CLASSIFICATION_RULES: ReadonlyArray<{
  pattern: RegExp;
  category: FailureCategory;
  retryable: boolean;
}> = [
  // Auth errors — never retry (token is invalid/expired)
  { pattern: /auth(?:entication)?\s+fail/i, category: "AUTH_ERROR", retryable: false },
  { pattern: /401\s+unauthorized/i, category: "AUTH_ERROR", retryable: false },
  { pattern: /no\s+linkedin\s+access\s+token/i, category: "AUTH_ERROR", retryable: false },
  { pattern: /token\s+expired/i, category: "AUTH_ERROR", retryable: false },
  { pattern: /invalid\s+token/i, category: "AUTH_ERROR", retryable: false },

  // Rate limiting — retryable with backoff
  { pattern: /429\s+too\s+many\s+requests/i, category: "RATE_LIMIT", retryable: true },
  { pattern: /rate\s+limit/i, category: "RATE_LIMIT", retryable: true },
  { pattern: /throttl/i, category: "RATE_LIMIT", retryable: true },
  { pattern: /quota\s+exceeded/i, category: "RATE_LIMIT", retryable: true },

  // Network errors — retryable with backoff
  { pattern: /ETIMEDOUT/i, category: "NETWORK_ERROR", retryable: true },
  { pattern: /ECONNRESET/i, category: "NETWORK_ERROR", retryable: true },
  { pattern: /ECONNREFUSED/i, category: "NETWORK_ERROR", retryable: true },
  { pattern: /ENOTFOUND/i, category: "NETWORK_ERROR", retryable: true },
  { pattern: /fetch\s+failed/i, category: "NETWORK_ERROR", retryable: true },
  { pattern: /network\s+error/i, category: "NETWORK_ERROR", retryable: true },
  { pattern: /timeout/i, category: "NETWORK_ERROR", retryable: true },
  { pattern: /socket\s+hang\s+up/i, category: "NETWORK_ERROR", retryable: true },

  // Invalid media — never retry (content issue)
  { pattern: /unsupported\s+image\s+format/i, category: "INVALID_MEDIA", retryable: false },
  { pattern: /image\s+file\s+not\s+found/i, category: "INVALID_MEDIA", retryable: false },
  { pattern: /file\s+size\s+exceeds/i, category: "INVALID_MEDIA", retryable: false },
  { pattern: /invalid\s+media/i, category: "INVALID_MEDIA", retryable: false },

  // Flow Agent errors — never retry (upstream issue)
  { pattern: /flow\s+agent/i, category: "FLOW_AGENT_ERROR", retryable: false },
  { pattern: /flow\s+agent\s+http/i, category: "FLOW_AGENT_ERROR", retryable: false },

  // LinkedIn rejection — never retry (content policy)
  { pattern: /linkedin\s+rejected/i, category: "LINKEDIN_REJECTED", retryable: false },
  { pattern: /content\s+policy/i, category: "LINKEDIN_REJECTED", retryable: false },
  { pattern: /post\s+rejected/i, category: "LINKEDIN_REJECTED", retryable: false },
  { pattern: /violation/i, category: "LINKEDIN_REJECTED", retryable: false },

  // Ambiguous errors — do not blindly retry (may have succeeded)
  { pattern: /409\s+conflict/i, category: "UNKNOWN", retryable: false },
];

/**
 * Classify a publish error message into a failure category.
 *
 * @param errorMessage - The error message from the publish attempt.
 * @returns Classified failure with category and retryability.
 */
export function classifyFailure(errorMessage: string | undefined): ClassifiedFailure {
  const message = errorMessage ?? "Unknown error";

  for (const rule of CLASSIFICATION_RULES) {
    if (rule.pattern.test(message)) {
      return {
        category: rule.category,
        retryable: rule.retryable,
        message,
      };
    }
  }

  return {
    category: "UNKNOWN",
    retryable: false,
    message,
  };
}
