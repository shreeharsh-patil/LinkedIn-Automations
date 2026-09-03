// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { FlowAgentClient, FlowAgentError } from "./flow-agent-client.js";
import type { AutomationConfig } from "../config/config.js";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeConfig(overrides?: Partial<AutomationConfig>): AutomationConfig {
  return {
    flowAgentUrl: "http://127.0.0.1:8001",
    linkedinProfile: undefined,
    flowGenerationTimeoutMs: 300_000,
    flowHealthTimeoutMs: 5_000,
    ...overrides,
  };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(status: number, detail: string): Response {
  return new Response(JSON.stringify({ detail }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("FlowAgentClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("health", () => {
    it("returns health status on success", async () => {
      mockFetch.mockResolvedValue(
        jsonResponse({
          status: "healthy",
          extension_connected: true,
          has_flow_key: true,
        }),
      );

      const client = new FlowAgentClient(makeConfig());
      const status = await client.health();

      expect(status.status).toBe("healthy");
      expect(status.extensionConnected).toBe(true);
      expect(status.hasFlowKey).toBe(true);
    });

    it("returns false for missing extension fields", async () => {
      mockFetch.mockResolvedValue(jsonResponse({ status: "starting" }));

      const client = new FlowAgentClient(makeConfig());
      const status = await client.health();

      expect(status.status).toBe("starting");
      expect(status.extensionConnected).toBe(false);
      expect(status.hasFlowKey).toBe(false);
    });

    it("throws FlowAgentError on network failure", async () => {
      mockFetch.mockRejectedValue(new TypeError("fetch failed"));

      const client = new FlowAgentClient(makeConfig());
      await expect(client.health()).rejects.toThrow(FlowAgentError);
      await expect(client.health()).rejects.toThrow("Flow Agent is unavailable");
    });

    it("throws FlowAgentError on abort (simulating timeout)", async () => {
      mockFetch.mockImplementation(() => {
        return new Promise((_, reject) => {
          // Simulate the AbortController aborting the request
          setTimeout(() => reject(new DOMException("The operation was aborted.", "AbortError")), 10);
        });
      });

      const client = new FlowAgentClient(makeConfig({ flowHealthTimeoutMs: 5000 }));
      await expect(client.health()).rejects.toThrow(FlowAgentError);
    });

    it("throws FlowAgentError on HTTP error", async () => {
      mockFetch.mockResolvedValue(errorResponse(503, "Service unavailable"));

      const client = new FlowAgentClient(makeConfig());
      await expect(client.health()).rejects.toThrow(FlowAgentError);
      await expect(client.health()).rejects.toThrow("503");
    });
  });

  describe("generateImage", () => {
    it("throws for empty prompt", async () => {
      const client = new FlowAgentClient(makeConfig());
      await expect(client.generateImage({ prompt: "  " })).rejects.toThrow(FlowAgentError);
      await expect(client.generateImage({ prompt: "  " })).rejects.toThrow("prompt cannot be empty");
    });

    it("throws for invalid count", async () => {
      const client = new FlowAgentClient(makeConfig());
      await expect(client.generateImage({ prompt: "test", count: 0 })).rejects.toThrow("count must be between 1 and 4");
      await expect(client.generateImage({ prompt: "test", count: 5 })).rejects.toThrow("count must be between 1 and 4");
    });

    it("sends correct request to Flow Agent", async () => {
      // Mock health check for ensureBackendRunning, then mock image generation
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ status: "healthy", extension_connected: true, has_flow_key: true }))
        .mockResolvedValueOnce(
          jsonResponse({
            created: 1234567890,
            data: [{ url: "http://example.com/image.png", media_id: "mid_123" }],
          }),
        );

      const client = new FlowAgentClient(makeConfig());
      const images = await client.generateImage({
        prompt: "technical architecture diagram",
        aspect: "landscape",
        count: 1,
      });

      // Second call is the image generation request
      expect(mockFetch).toHaveBeenLastCalledWith(
        "http://127.0.0.1:8001/v1/images/generations",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            prompt: "technical architecture diagram",
            model: "gem_pix_2",
            n: 1,
            size: "1792x1024",
            response_format: "url",
          }),
        }),
      );

      expect(images).toHaveLength(1);
      const first = images[0];
      expect(first?.url).toBe("http://example.com/image.png");
      expect(first?.mediaId).toBe("mid_123");
    });

    it("returns multiple images", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ status: "healthy", extension_connected: true, has_flow_key: true }))
        .mockResolvedValueOnce(
          jsonResponse({
            created: 1234567890,
            data: [{ url: "http://example.com/img1.png" }, { url: "http://example.com/img2.png", media_id: "mid_456" }],
          }),
        );

      const client = new FlowAgentClient(makeConfig());
      const images = await client.generateImage({ prompt: "test", count: 2 });

      expect(images).toHaveLength(2);
    });

    it("filters out results without URLs", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ status: "healthy", extension_connected: true, has_flow_key: true }))
        .mockResolvedValueOnce(
          jsonResponse({
            created: 1234567890,
            data: [
              { url: "http://example.com/img1.png" },
              { warning: "download failed" },
              { url: "", media_id: "mid_789" },
            ],
          }),
        );

      const client = new FlowAgentClient(makeConfig());
      const images = await client.generateImage({ prompt: "test" });

      expect(images).toHaveLength(1);
      const first = images[0];
      expect(first?.url).toBe("http://example.com/img1.png");
    });

    it("throws when no images are generated", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ status: "healthy", extension_connected: true, has_flow_key: true }))
        .mockResolvedValueOnce(
          jsonResponse({
            created: 1234567890,
            data: [],
          }),
        );

      const client = new FlowAgentClient(makeConfig());
      await expect(client.generateImage({ prompt: "test" })).rejects.toThrow("no generated images");
    });

    it("defaults to landscape aspect", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ status: "healthy", extension_connected: true, has_flow_key: true }))
        .mockResolvedValueOnce(jsonResponse({ created: 1234567890, data: [{ url: "http://example.com/img.png" }] }));

      const client = new FlowAgentClient(makeConfig());
      await client.generateImage({ prompt: "test" });

      // Check the image generation call (second call)
      const imageCall = mockFetch.mock.calls[1];
      const body = JSON.parse(String(imageCall?.[1]?.body)) as Record<string, unknown>;
      expect(body["size"]).toBe("1792x1024");
    });

    it("maps square aspect correctly", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ status: "healthy", extension_connected: true, has_flow_key: true }))
        .mockResolvedValueOnce(jsonResponse({ created: 1234567890, data: [{ url: "http://example.com/img.png" }] }));

      const client = new FlowAgentClient(makeConfig());
      await client.generateImage({ prompt: "test", aspect: "square" });

      // Check the image generation call (second call)
      const imageCall = mockFetch.mock.calls[1];
      const body = JSON.parse(String(imageCall?.[1]?.body)) as Record<string, unknown>;
      expect(body["size"]).toBe("1024x1024");
    });

    it("throws FlowAgentError on HTTP error", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ status: "healthy", extension_connected: true, has_flow_key: true }))
        .mockResolvedValueOnce(errorResponse(400, "Invalid prompt"));

      const client = new FlowAgentClient(makeConfig());
      await expect(client.generateImage({ prompt: "test" })).rejects.toThrow(FlowAgentError);
    });
  });

  describe("constructor", () => {
    it("uses config values", () => {
      const config = makeConfig({
        flowAgentUrl: "https://flow.example.com",
        flowGenerationTimeoutMs: 60_000,
        flowHealthTimeoutMs: 2_000,
      });
      const client = new FlowAgentClient(config);
      expect(client).toBeDefined();
    });
  });
});
