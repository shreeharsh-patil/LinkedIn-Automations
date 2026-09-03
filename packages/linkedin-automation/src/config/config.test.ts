// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";

import { loadConfig, ConfigurationError } from "./config.js";

describe("loadConfig", () => {
  it("returns defaults when no environment variables are set", () => {
    const config = loadConfig({});
    expect(config.flowAgentUrl).toBe("http://127.0.0.1:8001");
    expect(config.linkedinProfile).toBeUndefined();
    expect(config.flowGenerationTimeoutMs).toBe(300_000);
    expect(config.flowHealthTimeoutMs).toBe(5_000);
  });

  it("uses FLOW_AGENT_URL from environment", () => {
    const config = loadConfig({ FLOW_AGENT_URL: "http://custom-host:9000" });
    expect(config.flowAgentUrl).toBe("http://custom-host:9000");
  });

  it("strips trailing slashes from FLOW_AGENT_URL", () => {
    const config = loadConfig({ FLOW_AGENT_URL: "http://localhost:8001///" });
    expect(config.flowAgentUrl).toBe("http://localhost:8001");
  });

  it("uses LINKEDCTL_PROFILE from environment", () => {
    const config = loadConfig({ LINKEDCTL_PROFILE: "work" });
    expect(config.linkedinProfile).toBe("work");
  });

  it("parses FLOW_GENERATION_TIMEOUT_MS", () => {
    const config = loadConfig({ FLOW_GENERATION_TIMEOUT_MS: "60000" });
    expect(config.flowGenerationTimeoutMs).toBe(60_000);
  });

  it("parses FLOW_HEALTH_TIMEOUT_MS", () => {
    const config = loadConfig({ FLOW_HEALTH_TIMEOUT_MS: "2000" });
    expect(config.flowHealthTimeoutMs).toBe(2_000);
  });

  it("throws ConfigurationError for invalid FLOW_AGENT_URL", () => {
    expect(() => loadConfig({ FLOW_AGENT_URL: "not-a-url" })).toThrow(ConfigurationError);
    expect(() => loadConfig({ FLOW_AGENT_URL: "not-a-url" })).toThrow("Invalid Flow Agent URL");
  });

  it("throws ConfigurationError for empty FLOW_AGENT_URL", () => {
    expect(() => loadConfig({ FLOW_AGENT_URL: "   " })).toThrow(ConfigurationError);
  });

  it("throws ConfigurationError for non-positive FLOW_GENERATION_TIMEOUT_MS", () => {
    expect(() => loadConfig({ FLOW_GENERATION_TIMEOUT_MS: "0" })).toThrow(ConfigurationError);
    expect(() => loadConfig({ FLOW_GENERATION_TIMEOUT_MS: "-100" })).toThrow(ConfigurationError);
    expect(() => loadConfig({ FLOW_GENERATION_TIMEOUT_MS: "abc" })).toThrow(ConfigurationError);
  });

  it("throws ConfigurationError for non-positive FLOW_HEALTH_TIMEOUT_MS", () => {
    expect(() => loadConfig({ FLOW_HEALTH_TIMEOUT_MS: "0" })).toThrow(ConfigurationError);
    expect(() => loadConfig({ FLOW_HEALTH_TIMEOUT_MS: "abc" })).toThrow(ConfigurationError);
  });

  it("accepts HTTPS URLs", () => {
    const config = loadConfig({ FLOW_AGENT_URL: "https://flow.example.com:8001" });
    expect(config.flowAgentUrl).toBe("https://flow.example.com:8001");
  });
});
