// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { stat } from "node:fs/promises";
import { extname } from "node:path";

import { SUPPORTED_IMAGE_TYPES } from "@linkedctl/core";

import { LinkedCtlPublisher } from "./linkedctl-publisher.js";
import { generateVisual } from "../flow/generated-visual.js";
import { createVisualDirector } from "../flow/visual-director.js";
import type { AutomationConfig } from "../config/config.js";
import type { PublishResult } from "../types/index.js";

/**
 * Maximum image file size: 5 MB.
 */
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * Options for creating a manual LinkedIn post.
 */
export interface ManualPostOptions {
  /** The post text content. Must not be empty. */
  text: string;
  /** Optional local file path to an image. */
  imagePath?: string | undefined;
  /** Optional alt text for the image (informational, not published to LinkedIn). */
  altText?: string | undefined;
  /** Skip confirmation and publish immediately. Defaults to `false`. */
  dryRun?: boolean | undefined;
  /** LinkedIn profile name. */
  profile?: string | undefined;
  /** Generate an image via Flow Agent instead of using a local file. */
  generateVisual?: boolean | undefined;
  /** Optional technical context to guide visual generation. */
  technicalContext?: string | undefined;
  /** Automation config (required when generateVisual is true). */
  automationConfig?: AutomationConfig | undefined;
}

/**
 * Validated and resolved manual post ready for publishing or preview.
 */
export interface ManualPostPreview {
  /** The post text content. */
  text: string;
  /** Resolved image file path, if provided. */
  imagePath: string | undefined;
  /** Image MIME type, if image is provided. */
  imageContentType: string | undefined;
  /** Image file size in bytes, if image is provided. */
  imageSizeBytes: number | undefined;
  /** Alt text for the image. */
  altText: string | undefined;
  /** Whether this is a dry run. */
  dryRun: boolean;
  /** Whether the image was generated via Flow Agent. */
  generatedImage: boolean;
  /** Visual generation error message (if generation failed but post can continue). */
  visualError: string | undefined;
}

/**
 * Error thrown when manual post validation fails.
 */
export class ManualPostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManualPostError";
  }
}

/**
 * Validate a manual post configuration and return a preview.
 *
 * Performs all validation without publishing:
 * - Text is not empty
 * - Image file exists and is readable
 * - Image MIME type is supported
 * - Image file size is within limits
 */
export async function validateManualPost(options: ManualPostOptions): Promise<ManualPostPreview> {
  const text = options.text.trim();
  if (text === "") {
    throw new ManualPostError("Post text cannot be empty");
  }

  // If neither imagePath nor generateVisual, return text-only preview
  if ((options.imagePath === undefined || options.imagePath === "") && options.generateVisual !== true) {
    return {
      text,
      imagePath: undefined,
      imageContentType: undefined,
      imageSizeBytes: undefined,
      altText: options.altText,
      dryRun: options.dryRun ?? false,
      generatedImage: false,
      visualError: undefined,
    };
  }

  // Handle Flow Agent image generation
  if (options.generateVisual === true) {
    if (options.automationConfig === undefined) {
      throw new ManualPostError("Automation config is required when generateVisual is true");
    }

    const director = createVisualDirector();
    const decision = director.decide({
      text,
      technicalContext: options.technicalContext,
    });

    if (decision.type === "NONE") {
      return {
        text,
        imagePath: undefined,
        imageContentType: undefined,
        imageSizeBytes: undefined,
        altText: options.altText,
        dryRun: options.dryRun ?? false,
        generatedImage: false,
        visualError: undefined,
      };
    }

    // Attempt generation — don't throw on failure, let user decide
    const visualResult = await generateVisual(decision.prompt ?? "", options.automationConfig);

    if (visualResult.success && visualResult.imagePath !== undefined) {
      const imagePath = visualResult.imagePath;
      const { stat: statFn } = await import("node:fs/promises");
      const fileStats = await statFn(imagePath);
      return {
        text,
        imagePath,
        imageContentType: "image/png",
        imageSizeBytes: fileStats.size,
        altText: options.altText,
        dryRun: options.dryRun ?? false,
        generatedImage: true,
        visualError: undefined,
      };
    }

    // Generation failed — allow post to continue without image
    return {
      text,
      imagePath: undefined,
      imageContentType: undefined,
      imageSizeBytes: undefined,
      altText: options.altText,
      dryRun: options.dryRun ?? false,
      generatedImage: false,
      visualError: visualResult.error,
    };
  }

  const filePath = options.imagePath ?? "";

  // Check file exists before validating extension
  let fileStats;
  try {
    fileStats = await stat(filePath);
  } catch {
    throw new ManualPostError(`Image file not found: ${filePath}`);
  }

  if (!fileStats.isFile()) {
    throw new ManualPostError(`Path is not a file: ${filePath}`);
  }

  const ext = extname(filePath).toLowerCase();
  const contentType = SUPPORTED_IMAGE_TYPES.get(ext);
  if (contentType === undefined) {
    const supported = [...SUPPORTED_IMAGE_TYPES.keys()].join(", ");
    throw new ManualPostError(`Unsupported image format "${ext}". Supported formats: ${supported}`);
  }

  if (fileStats.size > MAX_IMAGE_SIZE_BYTES) {
    const sizeMB = Math.round(fileStats.size / (1024 * 1024));
    throw new ManualPostError(`Image file is ${sizeMB} MB, which exceeds the 5 MB limit`);
  }

  return {
    text,
    imagePath: filePath,
    imageContentType: contentType,
    imageSizeBytes: fileStats.size,
    altText: options.altText,
    dryRun: options.dryRun ?? false,
    generatedImage: false,
    visualError: undefined,
  };
}

/**
 * Format a preview for display to the user.
 */
export function formatPreview(preview: ManualPostPreview): string {
  const lines: string[] = [];
  lines.push("═══════════════════════════════════════════");
  lines.push("  LinkedIn Post Preview");
  lines.push("═══════════════════════════════════════════");
  lines.push("");
  lines.push("Caption:");
  lines.push(preview.text);
  lines.push("");
  if (preview.imagePath !== undefined) {
    const source = preview.generatedImage ? "(generated)" : "";
    lines.push(`Image:  ${preview.imagePath} ${source}`.trimEnd());
    if (preview.imageContentType !== undefined && preview.imageSizeBytes !== undefined) {
      const sizeKB = Math.round(preview.imageSizeBytes / 1024);
      lines.push(`Type:   ${preview.imageContentType} (${sizeKB} KB)`);
    }
    if (preview.altText !== undefined && preview.altText !== "") {
      lines.push(`Alt:    ${preview.altText}`);
    }
  } else if (preview.visualError !== undefined) {
    lines.push(`Image:  (generation failed)`);
    lines.push(`Error:  ${preview.visualError}`);
    lines.push("Hint:   You can upload your own image with --image, or retry later.");
  } else {
    lines.push("Image:  (none)");
  }
  lines.push("");
  if (preview.dryRun) {
    lines.push("[DRY RUN] — no post will be published");
  } else {
    lines.push("Ready to publish.");
  }
  lines.push("═══════════════════════════════════════════");
  return lines.join("\n");
}

/**
 * Publish a validated manual post to LinkedIn.
 *
 * Returns the publish result without throwing.
 */
export async function publishManualPost(preview: ManualPostPreview, profile?: string): Promise<PublishResult> {
  const publisher = new LinkedCtlPublisher(profile);

  if (preview.imagePath !== undefined) {
    return publisher.publishImage({
      text: preview.text,
      imagePath: preview.imagePath,
    });
  }

  return publisher.publishText({
    text: preview.text,
  });
}

/**
 * Execute the full manual post workflow: validate, preview, and optionally publish.
 *
 * Returns the preview and publish result (if not dry run).
 */
export async function createManualPost(options: ManualPostOptions): Promise<{
  preview: ManualPostPreview;
  result: PublishResult | undefined;
}> {
  const preview = await validateManualPost(options);

  if (preview.dryRun) {
    return { preview, result: undefined };
  }

  const result = await publishManualPost(preview, options.profile);
  return { preview, result };
}
