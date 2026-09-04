// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { AutomationConfig } from "../config/config.js";

// Mock FlowAgentClient as a proper class
vi.mock("./flow-agent-client.js", () => {
  const healthMock = vi.fn();
  const generateImageMock = vi.fn();

  return {
    FlowAgentClient: class MockFlowAgentClient {
      health = healthMock;
      generateImage = generateImageMock;
    },
    FlowAgentError: class FlowAgentError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "FlowAgentError";
      }
    },
    _healthMock: healthMock,
    _generateImageMock: generateImageMock,
  };
});

// Mock fs writes
vi.mock("node:fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockResolvedValue({ isFile: () => true, size: 1024 }),
}));

// Mock fetch for image download
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { generateVisual } from "./generated-visual.js";
import { _healthMock, _generateImageMock } from "./flow-agent-client.js";

const healthMock = vi.mocked(_healthMock);
const generateImageMock = vi.mocked(_generateImageMock);

function makeConfig(): AutomationConfig {
  return {
    flowAgentUrl: "http://127.0.0.1:8001",
    linkedinProfile: undefined,
    flowGenerationTimeoutMs: 300_000,
    flowHealthTimeoutMs: 5_000,
  };
}

describe("generateVisual", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns error for empty prompt", async () => {
    const result = await generateVisual("", makeConfig());
    expect(result.success).toBe(false);
    expect(result.error).toContain("empty");
  });

  it("returns error when health check fails", async () => {
    healthMock.mockRejectedValue(new Error("Connection refused"));

    const result = await generateVisual("test prompt", makeConfig());
    expect(result.success).toBe(false);
    expect(result.error).toContain("health check failed");
  });

  it("returns error when extension not connected", async () => {
    healthMock.mockResolvedValue({
      status: "starting",
      extensionConnected: false,
      hasFlowKey: false,
    });

    const result = await generateVisual("test prompt", makeConfig());
    expect(result.success).toBe(false);
    expect(result.error).toContain("not ready");
  });

  it("returns error when generation fails", async () => {
    healthMock.mockResolvedValue({
      status: "healthy",
      extensionConnected: true,
      hasFlowKey: true,
    });
    generateImageMock.mockRejectedValue(new Error("Generation failed"));

    const result = await generateVisual("test prompt", makeConfig());
    expect(result.success).toBe(false);
    expect(result.error).toContain("generation failed");
  });

  it("returns error when no images returned", async () => {
    healthMock.mockResolvedValue({
      status: "healthy",
      extensionConnected: true,
      hasFlowKey: true,
    });
    generateImageMock.mockResolvedValue([]);

    const result = await generateVisual("test prompt", makeConfig());
    expect(result.success).toBe(false);
    expect(result.error).toContain("no images");
  });

  it("generates and downloads image successfully", async () => {
    healthMock.mockResolvedValue({
      status: "healthy",
      extensionConnected: true,
      hasFlowKey: true,
    });
    generateImageMock.mockResolvedValue([{ url: "http://example.com/generated.png", mediaId: "mid_123" }]);

    // Mock fetch to return image bytes
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
    });

    const result = await generateVisual("Generate a technical diagram", makeConfig(), {
      aspect: "landscape",
    });

    expect(result.success).toBe(true);
    expect(result.imagePath).toBeDefined();
    expect(result.prompt).toBe("Generate a technical diagram");
    expect(result.error).toBeUndefined();
  });

  it("returns error when image download fails", async () => {
    healthMock.mockResolvedValue({
      status: "healthy",
      extensionConnected: true,
      hasFlowKey: true,
    });
    generateImageMock.mockResolvedValue([{ url: "http://example.com/generated.png", mediaId: "mid_123" }]);

    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
    });

    const result = await generateVisual("test prompt", makeConfig());
    expect(result.success).toBe(false);
    expect(result.error).toContain("download");
  });

  it("automatically recovers from PUBLIC_ERROR_UNSAFE_GENERATION by sanitizing prompt and retrying", async () => {
    healthMock.mockResolvedValue({
      status: "healthy",
      extensionConnected: true,
      hasFlowKey: true,
    });

    // First call rejects with Google Flow safety filter error
    generateImageMock
      .mockRejectedValueOnce(new Error("Flow Agent HTTP 400: Request contains an invalid argument. (PUBLIC_ERROR_UNSAFE_GENERATION)"))
      .mockResolvedValueOnce([{ url: "http://example.com/safe-recovered.png", mediaId: "mid_safe_456" }]);

    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
    });

    const result = await generateVisual(
      "Fixing deadlock crash and killing zombie processes during DDoS attack",
      makeConfig(),
    );

    expect(result.success).toBe(true);
    expect(result.sanitized).toBe(true);
    expect(result.prompt).not.toContain("killing");
    expect(result.prompt).not.toContain("DDoS attack");
    expect(generateImageMock).toHaveBeenCalledTimes(2);
  });
});
