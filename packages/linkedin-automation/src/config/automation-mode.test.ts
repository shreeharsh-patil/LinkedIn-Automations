// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";

import {
  loadAutomationMode,
  parseAutomationMode,
  allowsAutoPublish,
  shouldStopAtReview,
  AUTOMATION_MODES,
  DEFAULT_AUTOMATION_MODE,
} from "./automation-mode.js";

describe("parseAutomationMode", () => {
  it("parses 'safe' mode", () => {
    expect(parseAutomationMode("safe")).toBe("safe");
  });

  it("parses 'manual' as safe mode", () => {
    expect(parseAutomationMode("manual")).toBe("safe");
  });

  it("parses 'review' as safe mode", () => {
    expect(parseAutomationMode("review")).toBe("safe");
  });

  it("parses undefined as default (safe)", () => {
    expect(parseAutomationMode(undefined)).toBe("safe");
  });

  it("parses empty string as default (safe)", () => {
    expect(parseAutomationMode("")).toBe("safe");
  });

  it("parses full-auto mode", () => {
    expect(parseAutomationMode("full-auto")).toBe("full");
    expect(parseAutomationMode("auto")).toBe("full");
  });

  it("returns undefined for invalid mode", () => {
    expect(parseAutomationMode("invalid")).toBeUndefined();
    expect(parseAutomationMode("xyz")).toBeUndefined();
  });

  it("is case insensitive", () => {
    expect(parseAutomationMode("SAFE")).toBe("safe");
    expect(parseAutomationMode("Safe")).toBe("safe");
  });
});

describe("loadAutomationMode", () => {
  it("returns default when env is empty", () => {
    expect(loadAutomationMode({})).toBe(DEFAULT_AUTOMATION_MODE);
  });

  it("returns safe when AUTOMATION_MODE=safe", () => {
    expect(loadAutomationMode({ AUTOMATION_MODE: "safe" })).toBe("safe");
  });

  it("throws for invalid AUTOMATION_MODE", () => {
    expect(() => loadAutomationMode({ AUTOMATION_MODE: "invalid" })).toThrow("Invalid AUTOMATION_MODE");
  });

  it("parses full-auto mode", () => {
    expect(loadAutomationMode({ AUTOMATION_MODE: "full-auto" })).toBe("full");
  });
});

describe("allowsAutoPublish", () => {
  it("returns false for safe mode", () => {
    expect(allowsAutoPublish("safe")).toBe(false);
  });

  it("returns true for semi mode", () => {
    expect(allowsAutoPublish("semi")).toBe(true);
  });

  it("returns true for full mode", () => {
    expect(allowsAutoPublish("full")).toBe(true);
  });
});

describe("shouldStopAtReview", () => {
  it("returns true for safe mode", () => {
    expect(shouldStopAtReview("safe")).toBe(true);
  });

  it("returns false for semi mode", () => {
    expect(shouldStopAtReview("semi")).toBe(false);
  });

  it("returns false for full mode", () => {
    expect(shouldStopAtReview("full")).toBe(false);
  });
});

describe("AUTOMATION_MODES", () => {
  it("contains safe mode", () => {
    expect(AUTOMATION_MODES).toContain("safe");
  });

  it("has three modes", () => {
    expect(AUTOMATION_MODES).toHaveLength(3);
  });
});
