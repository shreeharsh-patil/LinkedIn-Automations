// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { readFile } from "node:fs/promises";
import { extname } from "node:path";

import {
  resolveConfig,
  LinkedInClient,
  getCurrentPersonUrn,
  getUserInfo,
  createPost,
  uploadImage,
  LinkedInApiError,
  LinkedInAuthError,
  SUPPORTED_IMAGE_TYPES,
} from "@linkedctl/core";

import type { AccountInfo, PublishImageOptions, PublishTextOptions, PublishResult } from "../types/index.js";

/**
 * Typed errors for LinkedIn adapter operations.
 */
export class LinkedInAdapterError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LinkedInAdapterError";
  }
}

/**
 * Adapter wrapping @linkedctl/core functions for LinkedIn posting.
 *
 * Does not duplicate any LinkedIn REST API logic. All operations delegate
 * to the existing core library functions.
 *
 * Access tokens are never exposed through this interface.
 */
export class LinkedCtlPublisher {
  private readonly profile: string | undefined;

  constructor(profile?: string) {
    this.profile = profile;
  }

  /**
   * Get the authenticated LinkedIn account information.
   *
   * Uses the OpenID Connect userinfo endpoint and resolves the person URN.
   */
  async getAccount(): Promise<AccountInfo> {
    const client = await this.createClient(["openid", "profile", "email"]);

    try {
      const [userInfo, personUrn] = await Promise.all([getUserInfo(client), getCurrentPersonUrn(client)]);

      return {
        sub: userInfo.sub,
        name: userInfo.name,
        givenName: userInfo.given_name,
        familyName: userInfo.family_name,
        picture: userInfo.picture,
        email: userInfo.email,
        personUrn,
      };
    } catch (error: unknown) {
      if (error instanceof LinkedInAuthError) {
        throw new LinkedInAdapterError("LinkedIn authentication failed — please re-authenticate", error);
      }
      if (error instanceof LinkedInApiError) {
        throw new LinkedInAdapterError(`LinkedIn API error: ${error.message}`, error);
      }
      throw new LinkedInAdapterError("Failed to retrieve LinkedIn account information", error);
    }
  }

  /**
   * Publish a text-only post to LinkedIn.
   */
  async publishText(options: PublishTextOptions): Promise<PublishResult> {
    if (options.text.trim() === "") {
      return { success: false, error: "Post text cannot be empty" };
    }

    const client = await this.createClient(["openid", "profile", "email", "w_member_social"]);

    try {
      const authorUrn = await getCurrentPersonUrn(client);
      const postUrn = await createPost(client, {
        author: authorUrn,
        text: options.text,
        visibility: options.visibility ?? "PUBLIC",
        lifecycleState: options.draft === true ? "DRAFT" : "PUBLISHED",
      });

      return this.normalizePostResult(postUrn);
    } catch (error: unknown) {
      return this.normalizeError(error);
    }
  }

  /**
   * Publish a LinkedIn post with an image attachment.
   *
   * Reads the image from the local filesystem, uploads it to LinkedIn,
   * and creates a post with the image attached.
   */
  async publishImage(options: PublishImageOptions): Promise<PublishResult> {
    if (options.text.trim() === "") {
      return { success: false, error: "Post text cannot be empty" };
    }

    const client = await this.createClient(["openid", "profile", "email", "w_member_social"]);

    try {
      const authorUrn = await getCurrentPersonUrn(client);
      const imageUrn = await this.uploadImageFile(client, authorUrn, options.imagePath);

      const postUrn = await createPost(client, {
        author: authorUrn,
        text: options.text,
        visibility: options.visibility ?? "PUBLIC",
        content: { media: { id: imageUrn } },
        lifecycleState: options.draft === true ? "DRAFT" : "PUBLISHED",
      });

      return this.normalizePostResult(postUrn);
    } catch (error: unknown) {
      return this.normalizeError(error);
    }
  }

  /**
   * Upload an image file to LinkedIn and return the image URN.
   */
  private async uploadImageFile(client: LinkedInClient, ownerUrn: string, filePath: string): Promise<string> {
    const ext = extname(filePath).toLowerCase();
    const contentType = SUPPORTED_IMAGE_TYPES.get(ext);
    if (contentType === undefined) {
      const supported = [...SUPPORTED_IMAGE_TYPES.keys()].join(", ");
      throw new LinkedInAdapterError(`Unsupported image format "${ext}". Supported formats: ${supported}`);
    }

    let data: Uint8Array;
    try {
      const buffer = await readFile(filePath);
      data = new Uint8Array(buffer);
    } catch (error: unknown) {
      throw new LinkedInAdapterError(`Failed to read image file: ${filePath}`, error);
    }

    return uploadImage(client, { owner: ownerUrn, data, contentType });
  }

  /**
   * Create a LinkedInClient from the resolved configuration.
   */
  private async createClient(requiredScopes: string[]): Promise<LinkedInClient> {
    try {
      const { config } = await resolveConfig({
        profile: this.profile,
        requiredScopes,
      });

      const accessToken = config.oauth?.accessToken;
      const apiVersion = config.apiVersion;

      if (accessToken === undefined || accessToken === "") {
        throw new LinkedInAdapterError("No LinkedIn access token configured — run `linkedctl auth login`");
      }
      if (apiVersion === undefined || apiVersion === "") {
        throw new LinkedInAdapterError("No LinkedIn API version configured — run `linkedctl auth setup`");
      }

      return new LinkedInClient({ accessToken, apiVersion });
    } catch (error: unknown) {
      if (error instanceof LinkedInAdapterError) {
        throw error;
      }
      throw new LinkedInAdapterError("Failed to create LinkedIn client from configuration", error);
    }
  }

  /**
   * Normalize a LinkedIn post URN into a structured result.
   */
  private normalizePostResult(postUrn: string): PublishResult {
    const urnParts = postUrn.split(":");
    const postId = urnParts[urnParts.length - 1];

    return {
      success: true,
      postId,
      postUrn,
      postUrl: `https://www.linkedin.com/feed/update/${postUrn}`,
    };
  }

  /**
   * Normalize errors into a structured PublishResult.
   */
  private normalizeError(error: unknown): PublishResult {
    if (error instanceof LinkedInAuthError) {
      return { success: false, error: `Authentication failed: ${error.message}` };
    }
    if (error instanceof LinkedInApiError) {
      return { success: false, error: `LinkedIn API error: ${error.message}` };
    }
    if (error instanceof LinkedInAdapterError) {
      return { success: false, error: error.message };
    }
    if (error instanceof Error) {
      return { success: false, error: error.message };
    }
    return { success: false, error: "Unknown error occurred" };
  }
}
