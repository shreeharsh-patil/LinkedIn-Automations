// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Normalized result from publishing a LinkedIn post.
 */
export interface PublishResult {
  /** Whether the publish operation succeeded. */
  success: boolean;
  /** LinkedIn post ID (numeric share ID). */
  postId?: string | undefined;
  /** LinkedIn post URN (e.g. `urn:li:share:123`). */
  postUrn?: string | undefined;
  /** Public URL to the published post. */
  postUrl?: string | undefined;
  /** Error message when success is false. */
  error?: string | undefined;
}

/**
 * Account information returned by the LinkedIn adapter.
 */
export interface AccountInfo {
  /** OpenID Connect subject identifier. */
  sub: string;
  /** Full display name. */
  name: string;
  /** Given name. */
  givenName: string;
  /** Family name. */
  familyName: string;
  /** Profile picture URL. */
  picture: string;
  /** Email address. */
  email: string;
  /** Person URN (e.g. `urn:li:person:abc123`). */
  personUrn: string;
}

/**
 * Options for publishing a text-only LinkedIn post.
 */
export interface PublishTextOptions {
  /** The post text content. */
  text: string;
  /** Post visibility. Defaults to `"PUBLIC"`. */
  visibility?: "PUBLIC" | "CONNECTIONS" | undefined;
  /** Save as draft instead of publishing. Defaults to `false`. */
  draft?: boolean | undefined;
}

/**
 * Options for publishing a LinkedIn post with an image.
 */
export interface PublishImageOptions {
  /** The post text content. */
  text: string;
  /** Local file path to the image to upload. */
  imagePath: string;
  /** Post visibility. Defaults to `"PUBLIC"`. */
  visibility?: "PUBLIC" | "CONNECTIONS" | undefined;
  /** Save as draft instead of publishing. Defaults to `false`. */
  draft?: boolean | undefined;
}

/**
 * Options for generating an image via Flow Agent.
 */
export interface GenerateImageOptions {
  /** Text prompt for image generation. */
  prompt: string;
  /** Aspect ratio. Defaults to `"landscape"`. */
  aspect?: "landscape" | "square" | "portrait" | "4x3" | "3x4" | undefined;
  /** Number of images to generate (1-4). Defaults to `1`. */
  count?: number | undefined;
  /** Optional reference image paths or media IDs. */
  references?: string[] | undefined;
}

/**
 * A single generated image result from Flow Agent.
 */
export interface GeneratedImage {
  /** URL to download the generated image. */
  url: string;
  /** Flow Agent media ID for the generated image. */
  mediaId?: string | undefined;
}

/**
 * Flow Agent health status.
 */
export interface FlowHealthStatus {
  /** Overall status: "healthy", "starting", or "unauthorized_or_disconnected". */
  status: string;
  /** Whether a Chrome extension is connected. */
  extensionConnected: boolean;
  /** Whether a Google Flow session key is available. */
  hasFlowKey: boolean;
}
