// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { cwd } from "node:process";

import type { AutomationConfig } from "../config/config.js";
import type { FlowHealthStatus, GenerateImageOptions, GeneratedImage } from "../types/index.js";

/**
 * Typed errors for Flow Agent operations.
 */
export class FlowAgentError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "FlowAgentError";
  }
}

/**
 * HTTP response from the Flow Agent image generation endpoint.
 */
interface FlowImageResponse {
  created: number;
  data: Array<{ url?: string; media_id?: string; warning?: string }>;
}

/**
 * HTTP response from the Flow Agent health endpoint.
 */
interface FlowHealthResponse {
  status: string;
  extension_connected?: boolean;
  has_flow_key?: boolean;
}

/**
 * Client for communicating with the Flow Agent HTTP API.
 *
 * All communication uses the existing Flow Agent REST endpoints on port 8001.
 * No generation logic is duplicated — this client delegates entirely to the
 * Flow Agent backend.
 *
 * The client can also auto-start the Flow Agent Python backend if it is not
 * already running, using the same logic as the flow-agent-main FlowClientService.
 */
export class FlowAgentClient {
  private readonly baseUrl: string;
  private readonly generationTimeoutMs: number;
  private readonly healthTimeoutMs: number;
  private backendProcess: ReturnType<typeof spawn> | null = null;

  constructor(config: AutomationConfig) {
    this.baseUrl = config.flowAgentUrl;
    this.generationTimeoutMs = config.flowGenerationTimeoutMs;
    this.healthTimeoutMs = config.flowHealthTimeoutMs;
  }

  /**
   * Check the Flow Agent health status.
   *
   * Returns the connection status of the Chrome extension and Google Flow
   * session key availability.
   */
  async health(): Promise<FlowHealthStatus> {
    const response = await this.request<FlowHealthResponse>("/health", {
      timeout: this.healthTimeoutMs,
    });

    return {
      status: response.status,
      extensionConnected: response.extension_connected ?? false,
      hasFlowKey: response.has_flow_key ?? false,
    };
  }

  /**
   * Ensure the Flow Agent Python backend is running.
   *
   * If the backend is not reachable, attempts to auto-start it by spawning
   * the Python process from the flow-agent directory. Polls with exponential
   * backoff until the backend becomes healthy or times out.
   *
   * @returns true if the backend is running, false if startup failed.
   */
  async ensureBackendRunning(): Promise<boolean> {
    try {
      const health = await this.health();
      if (health.status !== "unreachable") {
        return true;
      }
    } catch {
      // Backend is not running, try to start it
    }

    console.error("Flow Agent backend is not reachable. Attempting to start Python backend...");

    const possibleDirs: string[] = [
      resolve(cwd(), "flow-agent"),
      resolve(cwd(), "flow-agent-main", "flow-agent"),
      resolve(cwd(), "..", "flow-agent"),
      resolve(cwd(), "..", "flow-agent-main", "flow-agent"),
      resolve(cwd(), "..", "..", "flow-agent-main", "flow-agent"),
      resolve(__dirname, "..", "..", "..", "..", "flow-agent-main", "flow-agent"),
      resolve(__dirname, "..", "..", "flow-agent-main", "flow-agent"),
    ];
    let flowAgentDir: string = resolve(cwd(), "flow-agent");
    for (const d of possibleDirs) {
      if (existsSync(join(d, "main.py"))) {
        flowAgentDir = d;
        break;
      }
    }
    const isWin = process.platform === "win32";
    const venvPython = join(flowAgentDir, ".venv", isWin ? "Scripts" : "bin", isWin ? "python.exe" : "python");
    let pythonBin = existsSync(venvPython) ? venvPython : isWin ? "python" : "python3";
    if (isWin && !existsSync(venvPython)) {
      const candidates: string[] = [];
      if (process.env.PYTHON_BIN) candidates.push(process.env.PYTHON_BIN);
      candidates.push(
        "C:\\Users\\shree\\AppData\\Local\\Programs\\Python\\Python314\\python.exe",
        "C:\\Users\\shree\\AppData\\Local\\Programs\\Python\\Python312\\python.exe",
        "C:\\Users\\shree\\AppData\\Local\\Programs\\Python\\Python311\\python.exe"
      );
      for (const p of candidates) {
        if (existsSync(p)) {
          pythonBin = p;
          break;
        }
      }
    }
    const mainPy = join(flowAgentDir, "main.py");

    if (!existsSync(mainPy)) {
      console.error(`Could not locate flow-agent/main.py at ${mainPy}`);
      console.error("Please install the flow-agent: cd flow-agent && pip install -e .");
      return false;
    }

    try {
      this.backendProcess = spawn(pythonBin, [mainPy], {
        cwd: flowAgentDir,
        detached: false,
        stdio: "ignore",
      });

      console.error(`Spawned Flow Agent process (PID ${this.backendProcess.pid}). Waiting for startup...`);

      // Poll with exponential backoff for up to 30 seconds
      for (let attempt = 0; attempt < 7; attempt++) {
        const delay = Math.min(1000 * Math.pow(1.5, attempt), 10_000);
        await new Promise((resolve) => setTimeout(resolve, delay));
        try {
          const health = await this.health();
          if (health.status !== "unreachable") {
            console.error("Flow Agent Python backend started successfully!");
            return true;
          }
        } catch {
          // Still starting up
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`Failed to start Flow Agent backend: ${message}`);
    }

    // Cleanup orphan process if startup failed
    if (this.backendProcess !== null) {
      try {
        this.backendProcess.kill();
      } catch {
        // ignore
      }
      this.backendProcess = null;
    }

    console.error("Flow Agent backend failed to start. Please:");
    console.error("  1. Install Python dependencies: cd flow-agent && pip install -e .");
    console.error("  2. Start the backend manually: flow (or python flow-agent/main.py)");
    console.error("  3. Open Google Flow in Chrome and enable the Flow Agent extension");
    console.error(`  4. Verify the backend is running at ${this.baseUrl}`);
    return false;
  }

  /**
   * Generate images via the Flow Agent.
   *
   * Sends a request to the OpenAI-compatible `/v1/images/generations` endpoint
   * and returns the generated image URLs.
   */
  async generateImage(options: GenerateImageOptions): Promise<GeneratedImage[]> {
    const prompt = options.prompt.trim();
    if (prompt === "") {
      throw new FlowAgentError("Image generation prompt cannot be empty");
    }

    const count = options.count ?? 1;
    if (count < 1 || count > 4) {
      throw new FlowAgentError(`Image count must be between 1 and 4, got ${count}`);
    }

    // Ensure the backend is running before attempting generation
    const backendRunning = await this.ensureBackendRunning();
    if (!backendRunning) {
      throw new FlowAgentError(
        `Flow Agent is not available at ${this.baseUrl}. ` +
          "Please start the backend: flow (or python flow-agent/main.py)",
      );
    }

    const aspect = options.aspect ?? "landscape";
    const size = aspectToSize(aspect);

    const body: Record<string, unknown> = {
      prompt,
      model: "gem_pix_2",
      n: count,
      size,
      response_format: "url",
    };

    const response = await this.request<FlowImageResponse>("/v1/images/generations", {
      method: "POST",
      body,
      timeout: this.generationTimeoutMs,
    });

    const images: GeneratedImage[] = [];
    for (const item of response.data) {
      if (item.url !== undefined && item.url !== "") {
        images.push({
          url: item.url,
          mediaId: item.media_id,
        });
      }
    }

    if (images.length === 0) {
      throw new FlowAgentError("Flow Agent returned no generated images");
    }

    return images;
  }

  /**
   * Make an HTTP request to the Flow Agent.
   */
  private async request<T>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      timeout: number;
    },
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, options.timeout);

    try {
      const fetchOptions: RequestInit = {
        method: options.method ?? "GET",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
        },
      };

      if (options.body !== undefined) {
        fetchOptions.body = JSON.stringify(options.body);
      }

      const response = await fetch(url, fetchOptions);

      if (!response.ok) {
        let detail = "";
        try {
          const errorBody = (await response.json()) as Record<string, unknown>;
          detail = typeof errorBody["detail"] === "string" ? errorBody["detail"] : response.statusText;
        } catch {
          detail = response.statusText;
        }
        throw new FlowAgentError(`Flow Agent HTTP ${response.status}: ${detail}`);
      }

      return (await response.json()) as T;
    } catch (error: unknown) {
      if (error instanceof FlowAgentError) {
        throw error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new FlowAgentError(`Flow Agent request timed out after ${options.timeout}ms: ${path}`, error);
      }
      if (error instanceof TypeError) {
        throw new FlowAgentError(`Flow Agent is unavailable at ${this.baseUrl} — is it running?`, error);
      }
      throw new FlowAgentError(`Flow Agent request failed: ${path}`, error);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Map an aspect ratio to the size string expected by the Flow Agent API.
 */
function aspectToSize(aspect: string): string {
  const sizes: Record<string, string> = {
    landscape: "1792x1024",
    "4x3": "1365x1024",
    square: "1024x1024",
    "3x4": "1024x1365",
    portrait: "1024x1792",
  };
  return sizes[aspect] ?? "1792x1024";
}
