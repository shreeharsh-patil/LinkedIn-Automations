// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Structured application error categories.
 */
export type ErrorCategory =
  | "AUTH_ERROR"
  | "PERMISSION_ERROR"
  | "VALIDATION_ERROR"
  | "RATE_LIMIT_ERROR"
  | "MEDIA_ERROR"
  | "LINKEDIN_API_ERROR"
  | "GENERATION_ERROR"
  | "QUEUE_ERROR"
  | "DATABASE_ERROR";

/**
 * Regex patterns for redacting sensitive secrets from error messages and logs.
 */
const SENSITIVE_PATTERNS = [
  /bearer\s+[a-zA-Z0-9_\-\.]+/gi,
  /client_secret=[^&\s]+/gi,
  /clientSecret["']?\s*:\s*["'][^"']+["']/gi,
  /accessToken["']?\s*:\s*["'][^"']+["']/gi,
  /refreshToken["']?\s*:\s*["'][^"']+["']/gi,
  /authorization_code=[^&\s]+/gi,
  /code=[^&\s]+/gi,
  /AQ\.[a-zA-Z0-9_\-\.]+/g,
  /gsk_[a-zA-Z0-9]+/g,
  /sk-or-[a-zA-Z0-9_\-]+/g,
];

/**
 * Redact sensitive secrets from any string.
 */
export function redactSecrets(message: string): string {
  let cleaned = message;
  for (const pattern of SENSITIVE_PATTERNS) {
    cleaned = cleaned.replace(pattern, "[REDACTED]");
  }
  return cleaned;
}

/**
 * Structured base error class for LinkedCtl Automation.
 */
export class AutomationError extends Error {
  public readonly category: ErrorCategory;
  public readonly statusCode: number | undefined;
  public readonly retryable: boolean;
  public readonly details: Record<string, unknown> | undefined;

  constructor(
    category: ErrorCategory,
    message: string,
    options?: {
      cause?: unknown;
      statusCode?: number | undefined;
      retryable?: boolean;
      details?: Record<string, unknown> | undefined;
    }
  ) {
    const safeMessage = redactSecrets(message);
    super(safeMessage);
    this.name = "AutomationError";
    this.category = category;
    this.statusCode = options?.statusCode;
    this.retryable = options?.retryable ?? false;
    this.details = options?.details;
    if (options?.cause) {
      this.cause = options.cause;
    }
  }

  public toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      category: this.category,
      message: this.message,
      statusCode: this.statusCode,
      retryable: this.retryable,
      details: this.details,
    };
  }
}

export class AuthError extends AutomationError {
  constructor(message: string, options?: { cause?: unknown; statusCode?: number | undefined; details?: Record<string, unknown> | undefined }) {
    super("AUTH_ERROR", message, { ...options, retryable: false });
    this.name = "AuthError";
  }
}

export class PermissionError extends AutomationError {
  constructor(message: string, options?: { cause?: unknown; statusCode?: number | undefined; details?: Record<string, unknown> | undefined }) {
    super("PERMISSION_ERROR", message, { ...options, retryable: false });
    this.name = "PermissionError";
  }
}

export class ValidationError extends AutomationError {
  constructor(message: string, options?: { cause?: unknown; details?: Record<string, unknown> | undefined }) {
    super("VALIDATION_ERROR", message, { ...options, retryable: false });
    this.name = "ValidationError";
  }
}

export class RateLimitError extends AutomationError {
  public readonly resetAfterMs: number | undefined;

  constructor(message: string, options?: { cause?: unknown; resetAfterMs?: number | undefined; details?: Record<string, unknown> | undefined }) {
    super("RATE_LIMIT_ERROR", message, { ...options, statusCode: 429, retryable: true });
    this.name = "RateLimitError";
    this.resetAfterMs = options?.resetAfterMs;
  }
}

export class MediaError extends AutomationError {
  constructor(message: string, options?: { cause?: unknown; retryable?: boolean; details?: Record<string, unknown> | undefined }) {
    super("MEDIA_ERROR", message, { ...options, retryable: options?.retryable ?? false });
    this.name = "MediaError";
  }
}

export class LinkedInApiError extends AutomationError {
  constructor(message: string, options?: { cause?: unknown; statusCode?: number | undefined; retryable?: boolean; details?: Record<string, unknown> | undefined }) {
    super("LINKEDIN_API_ERROR", message, options);
    this.name = "LinkedInApiError";
  }
}

export class QueueError extends AutomationError {
  constructor(message: string, options?: { cause?: unknown; details?: Record<string, unknown> | undefined }) {
    super("QUEUE_ERROR", message, { ...options, retryable: true });
    this.name = "QueueError";
  }
}

export class DatabaseError extends AutomationError {
  constructor(message: string, options?: { cause?: unknown; details?: Record<string, unknown> | undefined }) {
    super("DATABASE_ERROR", message, { ...options, retryable: true });
    this.name = "DatabaseError";
  }
}
