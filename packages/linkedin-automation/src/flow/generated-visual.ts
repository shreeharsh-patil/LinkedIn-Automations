// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { AutomationConfig } from "../config/config.js";
import { FlowAgentClient, FlowAgentError } from "./flow-agent-client.js";

/**
 * Result of a visual generation attempt.
 */
export interface GeneratedVisualResult {
  /** Whether generation succeeded. */
  success: boolean;
  /** Local file path to the downloaded image (only when success is true). */
  imagePath: string | undefined;
  /** Error message (only when success is false). */
  error: string | undefined;
  /** The prompt that was used for generation. */
  prompt: string;
}

/**
 * Directory for temporary generated images.
 */
const TEMP_DIR_PREFIX = "linkedauto-visuals";

/**
 * Ensure the output directory exists.
 */
async function ensureOutputDir(): Promise<string> {
  const dir = join(tmpdir(), TEMP_DIR_PREFIX);
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Generate an image via Flow Agent and download it to a local file.
 *
 * Steps:
 * 1. Check Flow Agent health
 * 2. Request image generation
 * 3. Download the generated image from the returned URL
 * 4. Save to a local temp file
 * 5. Return the file path
 *
 * On any failure, returns a result with success=false and an error message
 * instead of throwing, so the post pipeline can continue without an image.
 */
export async function generateVisual(
  prompt: string,
  config: AutomationConfig,
  options?: {
    aspect?: "landscape" | "square" | "portrait" | "4x3" | "3x4" | undefined;
  },
): Promise<GeneratedVisualResult> {
  const trimmedPrompt = prompt.trim();
  if (trimmedPrompt === "") {
    return {
      success: false,
      imagePath: undefined,
      error: "Cannot generate visual: prompt is empty",
      prompt,
    };
  }

  const client = new FlowAgentClient(config);

  // Step 1: Check health
  let health;
  try {
    health = await client.health();
  } catch (error: unknown) {
    const message = error instanceof FlowAgentError ? error.message : "Unknown health check error";
    return {
      success: false,
      imagePath: undefined,
      error: `Flow Agent health check failed: ${message}`,
      prompt,
    };
  }

  if (!health.extensionConnected || !health.hasFlowKey) {
    return {
      success: false,
      imagePath: undefined,
      error: `Flow Agent is not ready (extension_connected=${health.extensionConnected}, has_flow_key=${health.hasFlowKey}). Open Google Flow in Chrome and enable the extension.`,
      prompt,
    };
  }

  // Step 2: Generate image
  let images;
  try {
    images = await client.generateImage({
      prompt: trimmedPrompt,
      aspect: options?.aspect ?? "landscape",
      count: 1,
    });
  } catch (error: unknown) {
    const message = error instanceof FlowAgentError ? error.message : "Unknown generation error";
    return {
      success: false,
      imagePath: undefined,
      error: `Image generation failed: ${message}`,
      prompt,
    };
  }

  if (images.length === 0) {
    return {
      success: false,
      imagePath: undefined,
      error: "Flow Agent returned no images",
      prompt,
    };
  }

  const imageUrl = images[0]?.url;
  if (imageUrl === undefined) {
    return {
      success: false,
      imagePath: undefined,
      error: "Flow Agent returned image without a URL",
      prompt,
    };
  }

  // Step 3: Download the image
  let localPath;
  try {
    localPath = await downloadImage(imageUrl);
  } catch (error: unknown) {
    const message = error instanceof FlowAgentError ? error.message : "Unknown download error";
    return {
      success: false,
      imagePath: undefined,
      error: `Image download failed: ${message}`,
      prompt,
    };
  }

  return {
    success: true,
    imagePath: localPath,
    error: undefined,
    prompt,
  };
}

/**
 * Download an image from a URL to a local temp file.
 */
async function downloadImage(url: string): Promise<string> {
  const outputDir = await ensureOutputDir();
  const filename = `visual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
  const filePath = join(outputDir, filename);

  const response = await fetch(url);
  if (!response.ok) {
    throw new FlowAgentError(`Failed to download image: HTTP ${response.status}`);
  }

  const buffer = new Uint8Array(await response.arrayBuffer());
  await writeFile(filePath, buffer);

  return filePath;
}
