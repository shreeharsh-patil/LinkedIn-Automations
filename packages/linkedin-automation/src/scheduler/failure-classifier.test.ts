// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";

import { classifyFailure } from "./failure-classifier.js";

describe("classifyFailure", () => {
  it("classifies auth errors", () => {
    expect(classifyFailure("Authentication failed").category).toBe("AUTH_ERROR");
    expect(classifyFailure("Authentication failed").retryable).toBe(false);
    expect(classifyFailure("401 Unauthorized").category).toBe("AUTH_ERROR");
    expect(classifyFailure("No LinkedIn access token configured").category).toBe("AUTH_ERROR");
    expect(classifyFailure("Token expired").category).toBe("AUTH_ERROR");
    expect(classifyFailure("Invalid token").category).toBe("AUTH_ERROR");
  });

  it("classifies rate limit errors", () => {
    expect(classifyFailure("429 Too Many Requests").category).toBe("RATE_LIMIT");
    expect(classifyFailure("429 Too Many Requests").retryable).toBe(true);
    expect(classifyFailure("Rate limit exceeded").category).toBe("RATE_LIMIT");
    expect(classifyFailure("Throttled by LinkedIn").category).toBe("RATE_LIMIT");
    expect(classifyFailure("Quota exceeded").category).toBe("RATE_LIMIT");
  });

  it("classifies network errors", () => {
    expect(classifyFailure("ETIMEDOUT").category).toBe("NETWORK_ERROR");
    expect(classifyFailure("ETIMEDOUT").retryable).toBe(true);
    expect(classifyFailure("ECONNRESET").category).toBe("NETWORK_ERROR");
    expect(classifyFailure("ECONNREFUSED").category).toBe("NETWORK_ERROR");
    expect(classifyFailure("ENOTFOUND").category).toBe("NETWORK_ERROR");
    expect(classifyFailure("fetch failed").category).toBe("NETWORK_ERROR");
    expect(classifyFailure("Network error").category).toBe("NETWORK_ERROR");
    expect(classifyFailure("Request timeout").category).toBe("NETWORK_ERROR");
    expect(classifyFailure("socket hang up").category).toBe("NETWORK_ERROR");
  });

  it("classifies invalid media errors", () => {
    expect(classifyFailure("Unsupported image format").category).toBe("INVALID_MEDIA");
    expect(classifyFailure("Unsupported image format").retryable).toBe(false);
    expect(classifyFailure("Image file not found").category).toBe("INVALID_MEDIA");
    expect(classifyFailure("File size exceeds limit").category).toBe("INVALID_MEDIA");
  });

  it("classifies Flow Agent errors", () => {
    expect(classifyFailure("Flow Agent HTTP 500").category).toBe("FLOW_AGENT_ERROR");
    expect(classifyFailure("Flow Agent HTTP 500").retryable).toBe(false);
    expect(classifyFailure("Flow Agent is unavailable").category).toBe("FLOW_AGENT_ERROR");
  });

  it("classifies LinkedIn rejection errors", () => {
    expect(classifyFailure("LinkedIn rejected the post").category).toBe("LINKEDIN_REJECTED");
    expect(classifyFailure("LinkedIn rejected the post").retryable).toBe(false);
    expect(classifyFailure("Content policy violation").category).toBe("LINKEDIN_REJECTED");
    expect(classifyFailure("Post rejected").category).toBe("LINKEDIN_REJECTED");
  });

  it("classifies unknown errors", () => {
    expect(classifyFailure("Something weird happened").category).toBe("UNKNOWN");
    expect(classifyFailure("Something weird happened").retryable).toBe(false);
    expect(classifyFailure("409 Conflict").category).toBe("UNKNOWN");
    expect(classifyFailure("409 Conflict").retryable).toBe(false);
  });

  it("handles undefined error message", () => {
    const result = classifyFailure(undefined);
    expect(result.category).toBe("UNKNOWN");
    expect(result.retryable).toBe(false);
    expect(result.message).toBe("Unknown error");
  });

  it("preserves original error message", () => {
    const message = "LinkedIn API error: rate limit exceeded";
    const result = classifyFailure(message);
    expect(result.message).toBe(message);
  });
});
