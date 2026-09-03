// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";

import { verifyClaims } from "./claim-verifier.js";
import type { Fact } from "./fact-extractor.js";

describe("verifyClaims", () => {
  it("returns empty result for empty draft", () => {
    const result = verifyClaims("", []);
    expect(result.claims).toHaveLength(0);
    expect(result.allSupported).toBe(true);
    expect(result.summary).toContain("No claims");
  });

  it("supports claims that match facts", () => {
    const facts: Fact[] = [
      { id: "fact-1", claim: "The backend uses FastAPI for the REST API", source: "user-context", confidence: 1.0 },
    ];

    const draft = "The backend uses FastAPI for the REST API endpoints.";

    const result = verifyClaims(draft, facts);
    expect(result.claims.length).toBeGreaterThanOrEqual(1);
    expect(result.claims[0]?.status).toBe("SUPPORTED");
    expect(result.allSupported).toBe(true);
  });

  it("flags unsupported claims", () => {
    const facts: Fact[] = [
      { id: "fact-1", claim: "Migrated from PostgreSQL to MySQL", source: "user-context", confidence: 1.0 },
    ];

    const draft =
      "Migrated from PostgreSQL to MySQL. The system now handles 10 million requests per day with zero downtime.";

    const result = verifyClaims(draft, facts);
    expect(result.allSupported).toBe(false);
    expect(result.claims.some((c) => c.status === "UNSUPPORTED")).toBe(true);
  });

  it("handles uncertain claims", () => {
    const facts: Fact[] = [
      {
        id: "fact-1",
        claim: "Improved query performance by rewriting the join logic",
        source: "user-context",
        confidence: 0.8,
      },
    ];

    const draft = "Rewriting the join logic improved query performance significantly.";

    const result = verifyClaims(draft, facts);
    // Should find a partial or full match
    expect(result.claims.length).toBeGreaterThanOrEqual(1);
  });

  it("verifies multiple claims", () => {
    const facts: Fact[] = [
      { id: "fact-1", claim: "Uses TypeScript for type safety", source: "user-context", confidence: 1.0 },
      { id: "fact-2", claim: "Migrated from Express to Fastify", source: "user-context", confidence: 1.0 },
    ];

    const draft =
      "Uses TypeScript for type safety throughout the codebase. Migrated from Express to Fastify for better performance.";

    const result = verifyClaims(draft, facts);
    expect(result.claims.length).toBeGreaterThanOrEqual(2);
  });

  it("provides summary with counts", () => {
    const facts: Fact[] = [{ id: "fact-1", claim: "Uses Redis for caching", source: "user-context", confidence: 1.0 }];

    const draft = "Uses Redis for caching. The deployment uses Kubernetes.";

    const result = verifyClaims(draft, facts);
    expect(result.summary).toContain("supported");
    expect(result.summary).toContain("unsupported");
  });

  it("handles draft with no factual sentences", () => {
    const facts: Fact[] = [];
    const draft = "OK";

    const result = verifyClaims(draft, facts);
    expect(result.claims).toHaveLength(0);
  });
});
