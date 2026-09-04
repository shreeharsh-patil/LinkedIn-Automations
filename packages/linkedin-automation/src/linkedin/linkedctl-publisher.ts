// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
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
  getTokenExpiry,
  refreshAccessToken,
  saveOAuthTokens,
} from "@linkedctl/core";

import type { AccountInfo, PublishImageOptions, PublishTextOptions, PublishResult } from "../types/index.js";
import { redactSecrets, AuthError, MediaError } from "../errors/index.js";

/**
 * Preflight authentication and permission report.
 */
export interface AuthPreflightReport {
  authenticated: boolean;
  activeProfile: string;
  isExpired: boolean;
  expiresAt?: string | undefined;
  scopes: {
    granted: string[];
    required: string[];
    missing: string[];
    canPost: boolean;
  };
  identity?: AccountInfo | undefined;
  apiVersion: string;
  error?: string | undefined;
  warning?: string | undefined;
}

/**
 * Typed errors for LinkedIn adapter operations.
 */
export class LinkedInAdapterError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(redactSecrets(message));
    this.name = "LinkedInAdapterError";
  }
}

const REQUIRED_POSTING_SCOPES = ["openid", "profile", "email", "w_member_social"];
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB LinkedIn limit

/**
 * Adapter wrapping @linkedctl/core functions for LinkedIn posting.
 *
 * Provides preflight authentication verification, automatic token refresh
 * when possible, robust media pre-validation, and safe structured error reporting.
 * Access tokens and secrets are never exposed.
 */
export class LinkedCtlPublisher {
  private readonly profile: string | undefined;

  constructor(profile?: string) {
    this.profile = profile;
  }

  /**
   * Run an authentication and permission preflight check.
   *
   * Verifies:
   * 1. Token presence
   * 2. Expiration (and attempts automatic refresh if expired)
   * 3. Required permissions (w_member_social)
   * 4. API version
   * 5. Active account identity via LinkedIn API
   */
  async preflightCheck(): Promise<AuthPreflightReport> {
    const activeProfile = this.profile ?? "default";

    let configResult;
    try {
      configResult = await resolveConfig({ profile: this.profile });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        authenticated: false,
        activeProfile,
        isExpired: false,
        scopes: { granted: [], required: REQUIRED_POSTING_SCOPES, missing: REQUIRED_POSTING_SCOPES, canPost: false },
        apiVersion: "unknown",
        error: `Configuration resolution failed: ${redactSecrets(msg)}`,
      };
    }

    const { config } = configResult;
    const oauth = config.oauth;
    let accessToken = oauth?.accessToken;
    const apiVersion = config.apiVersion ?? "20260101";

    if (!accessToken || accessToken.trim() === "") {
      return {
        authenticated: false,
        activeProfile,
        isExpired: false,
        scopes: { granted: [], required: REQUIRED_POSTING_SCOPES, missing: REQUIRED_POSTING_SCOPES, canPost: false },
        apiVersion,
        error: "No LinkedIn access token configured. Run `linkedctl auth login` or set LINKEDCTL_ACCESS_TOKEN.",
      };
    }

    // Check token expiration
    let isExpired = false;
    let expiresAt = oauth?.tokenExpiresAt;

    if (expiresAt) {
      const expDate = new Date(expiresAt);
      if (!isNaN(expDate.getTime()) && expDate.getTime() <= Date.now()) {
        isExpired = true;
      }
    } else {
      const jwtExpiry = getTokenExpiry(accessToken);
      if (jwtExpiry) {
        expiresAt = jwtExpiry.expiresAt.toISOString();
        isExpired = jwtExpiry.isExpired;
      }
    }

    // Attempt token refresh if expired and refresh token is available
    if (isExpired && oauth?.refreshToken && oauth?.clientId && oauth?.clientSecret) {
      try {
        const refreshed = await refreshAccessToken(
          {
            clientId: oauth.clientId,
            clientSecret: oauth.clientSecret,
            redirectUri: "",
            scope: oauth.scope ?? "",
          },
          oauth.refreshToken
        );
        accessToken = refreshed.accessToken;
        const newExpiry = new Date(Date.now() + refreshed.expiresIn * 1000).toISOString();
        expiresAt = newExpiry;
        isExpired = false;

        await saveOAuthTokens(
          {
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken ?? oauth.refreshToken,
            tokenExpiresAt: newExpiry,
          },
          { profile: this.profile }
        );
      } catch {
        // Refresh attempt failed, token remains expired
        isExpired = true;
      }
    }

    if (isExpired) {
      return {
        authenticated: false,
        activeProfile,
        isExpired: true,
        expiresAt,
        scopes: { granted: [], required: REQUIRED_POSTING_SCOPES, missing: REQUIRED_POSTING_SCOPES, canPost: false },
        apiVersion,
        error: "LinkedIn access token has expired. Please re-authenticate using `linkedctl auth login`.",
      };
    }

    // Check scopes
    const grantedScopes = oauth?.scope ? oauth.scope.split(" ").filter(Boolean) : [];
    const missingScopes = REQUIRED_POSTING_SCOPES.filter((s) => !grantedScopes.includes(s));
    const canPost = !missingScopes.includes("w_member_social");

    // Test LinkedIn API connection & identity
    const client = new LinkedInClient({ accessToken, apiVersion });
    let identity: AccountInfo | undefined;

    try {
      const [userInfo, personUrn] = await Promise.all([getUserInfo(client), getCurrentPersonUrn(client)]);
      identity = {
        sub: userInfo.sub,
        name: userInfo.name,
        givenName: userInfo.given_name,
        familyName: userInfo.family_name,
        picture: userInfo.picture,
        email: userInfo.email,
        personUrn,
      };
    } catch (err: unknown) {
      if (err instanceof LinkedInAuthError) {
        return {
          authenticated: false,
          activeProfile,
          isExpired: true,
          expiresAt,
          scopes: { granted: grantedScopes, required: REQUIRED_POSTING_SCOPES, missing: missingScopes, canPost: false },
          apiVersion,
          error: "LinkedIn rejected access token. Run `linkedctl auth login` to re-authenticate.",
        };
      }
      const msg = err instanceof Error ? err.message : String(err);
      return {
        authenticated: false,
        activeProfile,
        isExpired: false,
        expiresAt,
        scopes: { granted: grantedScopes, required: REQUIRED_POSTING_SCOPES, missing: missingScopes, canPost: false },
        apiVersion,
        error: `LinkedIn connectivity check failed: ${redactSecrets(msg)}`,
      };
    }

    let warning: string | undefined;
    if (!canPost) {
      warning = "Token lacks 'w_member_social' permission. You can view profile info, but publishing will fail.";
    }

    return {
      authenticated: true,
      activeProfile,
      isExpired: false,
      expiresAt,
      scopes: {
        granted: grantedScopes,
        required: REQUIRED_POSTING_SCOPES,
        missing: missingScopes,
        canPost,
      },
      identity,
      apiVersion,
      warning,
    };
  }

  /**
   * Get the authenticated LinkedIn account information.
   */
  async getAccount(): Promise<AccountInfo> {
    const preflight = await this.preflightCheck();
    if (!preflight.authenticated || !preflight.identity) {
      throw new LinkedInAdapterError(preflight.error || "Not authenticated with LinkedIn");
    }
    return preflight.identity;
  }

  /**
   * Publish a text-only post to LinkedIn with preflight authorization.
   */
  async publishText(options: PublishTextOptions): Promise<PublishResult> {
    if (options.text.trim() === "") {
      return { success: false, error: "Post text cannot be empty" };
    }

    const preflight = await this.preflightCheck();
    if (!preflight.authenticated) {
      return { success: false, error: preflight.error || "LinkedIn authentication failed." };
    }
    if (!preflight.scopes.canPost) {
      return {
        success: false,
        error: "Missing required LinkedIn publishing permission 'w_member_social'. Run `linkedctl auth login` to grant permission.",
      };
    }

    const client = await this.createClient(["openid", "profile", "email", "w_member_social"]);

    try {
      const authorUrn = preflight.identity?.personUrn ?? (await getCurrentPersonUrn(client));
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
   * Publish a LinkedIn post with an image attachment after full validation.
   */
  async publishImage(options: PublishImageOptions): Promise<PublishResult> {
    if (options.text.trim() === "") {
      return { success: false, error: "Post text cannot be empty" };
    }

    const preflight = await this.preflightCheck();
    if (!preflight.authenticated) {
      return { success: false, error: preflight.error || "LinkedIn authentication failed." };
    }
    if (!preflight.scopes.canPost) {
      return {
        success: false,
        error: "Missing required LinkedIn publishing permission 'w_member_social'. Run `linkedctl auth login`.",
      };
    }

    // Pre-validate media file before any API call
    try {
      await this.validateMediaFile(options.imagePath);
    } catch (mediaErr: unknown) {
      return {
        success: false,
        error: mediaErr instanceof Error ? mediaErr.message : "Media validation failed",
      };
    }

    const client = await this.createClient(["openid", "profile", "email", "w_member_social"]);

    try {
      const authorUrn = preflight.identity?.personUrn ?? (await getCurrentPersonUrn(client));
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
   * Validate local media file constraints (size, MIME type, existence).
   */
  private async validateMediaFile(filePath: string): Promise<void> {
    if (!filePath || filePath.trim() === "") {
      throw new MediaError("Image file path cannot be empty");
    }

    if (!existsSync(filePath)) {
      throw new MediaError(`Media file does not exist at: ${filePath}`);
    }

    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      throw new MediaError(`Specified path is not a file: ${filePath}`);
    }

    if (fileStat.size === 0) {
      throw new MediaError(`Image file is 0 bytes (corrupt or empty): ${filePath}`);
    }

    if (fileStat.size > MAX_IMAGE_SIZE_BYTES) {
      const sizeMb = (fileStat.size / (1024 * 1024)).toFixed(2);
      throw new MediaError(`Image size (${sizeMb} MB) exceeds LinkedIn's 10 MB maximum upload limit.`);
    }

    const ext = extname(filePath).toLowerCase();
    if (!SUPPORTED_IMAGE_TYPES.has(ext)) {
      const supported = [...SUPPORTED_IMAGE_TYPES.keys()].join(", ");
      throw new MediaError(`Unsupported image extension "${ext}". Supported formats: ${supported}`);
    }
  }

  /**
   * Upload an image file to LinkedIn and return the image URN.
   */
  private async uploadImageFile(client: LinkedInClient, ownerUrn: string, filePath: string): Promise<string> {
    await this.validateMediaFile(filePath);

    const ext = extname(filePath).toLowerCase();
    const contentType = SUPPORTED_IMAGE_TYPES.get(ext)!;

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
        throw new AuthError("No LinkedIn access token configured — run `linkedctl auth login`");
      }
      if (apiVersion === undefined || apiVersion === "") {
        throw new LinkedInAdapterError("No LinkedIn API version configured — run `linkedctl auth setup`");
      }

      return new LinkedInClient({ accessToken, apiVersion });
    } catch (error: unknown) {
      if (error instanceof LinkedInAdapterError || error instanceof AuthError) {
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
   * Normalize errors into a structured PublishResult without exposing secrets.
   */
  private normalizeError(error: unknown): PublishResult {
    if (error instanceof LinkedInAuthError) {
      return { success: false, error: redactSecrets(`Authentication failed: ${error.message}`) };
    }
    if (error instanceof LinkedInApiError) {
      return { success: false, error: redactSecrets(`LinkedIn API error: ${error.message}`) };
    }
    if (error instanceof LinkedInAdapterError || error instanceof MediaError || error instanceof AuthError) {
      return { success: false, error: redactSecrets(error.message) };
    }
    if (error instanceof Error) {
      return { success: false, error: redactSecrets(error.message) };
    }
    return { success: false, error: "Unknown error occurred" };
  }
}
