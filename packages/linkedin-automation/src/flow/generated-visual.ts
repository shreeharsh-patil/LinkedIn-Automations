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
  /** Whether the prompt was automatically sanitized to comply with safety filters. */
  sanitized?: boolean | undefined;
  /** The sanitized prompt used if safety rewrite was applied. */
  sanitizedPrompt?: string | undefined;
}

/**
 * Terms that commonly trip cloud image generation safety filters (e.g. Google Imagen).
 * Mapped to professional, neutral architectural design concepts.
 */
const UNSAFE_WORD_REPLACEMENTS: ReadonlyArray<[RegExp, string]> = [
  [/\b(kill(?:ing|ed|s)?|murder(?:ed|ing|s)?|die|death|destroy(?:ed|ing|s)?)\b/gi, "terminate and clean up"],
  [/\b(attack(?:ing|ed|er|ers|s)?|exploit(?:ed|ing|s)?|breach(?:ed|ing|s)?)\b/gi, "traffic surge analysis"],
  [/\b(hack(?:ing|ed|er|ers|s)?)\b/gi, "deep system inspection"],
  [/\b(crash(?:ed|ing|es)?|fatal(?:ity)?)\b/gi, "unhandled exception recovery"],
  [/\b(deadlock(?:ed|ing|s)?)\b/gi, "concurrency synchronization barrier"],
  [/\b(poison(?:\s*pill)?)\b/gi, "sentinel queue marker"],
  [/\b(zombie(?:s)?)\b/gi, "orphaned background task"],
  [/\b(penetrat(?:ion|ing|e))\b/gi, "automated security audit"],
  [/\b(weapon(?:s)?|gun(?:s)?|bullet(?:s)?|knife|knives)\b/gi, "hardware diagnostic tool"],
  [/\b(hijack(?:ed|ing|s)?|steal(?:ing|s)?|stolen)\b/gi, "unauthorized connection intercept"],
  [/\b(blood|gore|violent|violence)\b/gi, "high intensity activity"],
  [/\b(nude|naked|nsfw|sex(?:ual)?)\b/gi, "minimalist aesthetic"],
];

/**
 * Clean and transform prompts to avoid triggering strict cloud safety filters.
 */
export function sanitizeVisualPrompt(prompt: string): string {
  let cleaned = prompt;
  for (const [regex, replacement] of UNSAFE_WORD_REPLACEMENTS) {
    cleaned = cleaned.replace(regex, replacement);
  }

  // If the prompt is overly long (e.g. an entire raw post text), extract core technical terms
  if (cleaned.length > 250) {
    cleaned = cleaned.slice(0, 240);
  }

  // Ensure professional, abstract engineering aesthetic
  if (
    !cleaned.toLowerCase().includes("diagram") &&
    !cleaned.toLowerCase().includes("illustration") &&
    !cleaned.toLowerCase().includes("minimal")
  ) {
    cleaned = `${cleaned}, clean modern isometric 3D technical architecture diagram, subtle glowing nodes, sleek dark background, developer documentation aesthetic, no text`;
  }

  return cleaned.trim();
}

/**
 * Universal safe fallback prompt when all else fails safety filters.
 */
export const SAFE_FALLBACK_PROMPT =
  "Minimalist modern software architecture diagram, glowing modular server nodes, abstract data flow pathways, deep slate dark background, elegant technical editorial illustration, high resolution 8k, no text";

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
 * Automatically recovers from safety filter rejections (PUBLIC_ERROR_UNSAFE_GENERATION).
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

  // Step 2: Generate image with safety filter fallback & auto-retry
  let images;
  let finalPrompt = trimmedPrompt;
  let wasSanitized = false;

  try {
    images = await client.generateImage({
      prompt: finalPrompt,
      aspect: options?.aspect ?? "landscape",
      count: 1,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const isSafetyError =
      errorMsg.includes("UNSAFE_GENERATION") ||
      errorMsg.includes("invalid argument") ||
      errorMsg.includes("safety") ||
      errorMsg.includes("400");

    if (isSafetyError) {
      // Attempt 1: Retry with sanitized prompt
      const sanitized = sanitizeVisualPrompt(trimmedPrompt);
      if (sanitized !== trimmedPrompt) {
        try {
          finalPrompt = sanitized;
          wasSanitized = true;
          images = await client.generateImage({
            prompt: finalPrompt,
            aspect: options?.aspect ?? "landscape",
            count: 1,
          });
        } catch {
          // Attempt 2: Universal safe architectural illustration
          try {
            finalPrompt = SAFE_FALLBACK_PROMPT;
            wasSanitized = true;
            images = await client.generateImage({
              prompt: finalPrompt,
              aspect: options?.aspect ?? "landscape",
              count: 1,
            });
          } catch (fallbackError: unknown) {
            const fallbackMsg = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
            return {
              success: false,
              imagePath: undefined,
              error: `Image generation safety filter: Google Flow rejected the prompt (${fallbackMsg}). Please use an abstract architecture diagram prompt.`,
              prompt: finalPrompt,
              sanitized: true,
              sanitizedPrompt: finalPrompt,
            };
          }
        }
      } else {
        // Directly try universal safe prompt
        try {
          finalPrompt = SAFE_FALLBACK_PROMPT;
          wasSanitized = true;
          images = await client.generateImage({
            prompt: finalPrompt,
            aspect: options?.aspect ?? "landscape",
            count: 1,
          });
        } catch (fallbackError: unknown) {
          const fallbackMsg = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          return {
            success: false,
            imagePath: undefined,
            error: `Image generation safety filter: Google Flow rejected the prompt (${fallbackMsg}). Please use an abstract architecture diagram prompt.`,
            prompt: finalPrompt,
            sanitized: true,
            sanitizedPrompt: finalPrompt,
          };
        }
      }
    } else {
      const message = error instanceof FlowAgentError ? error.message : "Unknown generation error";
      return {
        success: false,
        imagePath: undefined,
        error: `Image generation failed: ${message}`,
        prompt: finalPrompt,
      };
    }
  }

  if (!images || images.length === 0) {
    return {
      success: false,
      imagePath: undefined,
      error: "Flow Agent returned no images",
      prompt: finalPrompt,
    };
  }

  const imageUrl = images[0]?.url;
  if (imageUrl === undefined) {
    return {
      success: false,
      imagePath: undefined,
      error: "Flow Agent returned image without a URL",
      prompt: finalPrompt,
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
      prompt: finalPrompt,
    };
  }

  return {
    success: true,
    imagePath: localPath,
    error: undefined,
    prompt: finalPrompt,
    sanitized: wasSanitized,
    sanitizedPrompt: wasSanitized ? finalPrompt : undefined,
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
