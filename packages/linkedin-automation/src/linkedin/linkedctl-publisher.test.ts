// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

// Mock @linkedctl/core before importing the publisher
vi.mock("@linkedctl/core", () => ({
  resolveConfig: vi.fn(),
  LinkedInClient: vi.fn(),
  getCurrentPersonUrn: vi.fn(),
  getUserInfo: vi.fn(),
  createPost: vi.fn(),
  uploadImage: vi.fn(),
  getTokenExpiry: vi.fn().mockReturnValue(undefined),
  refreshAccessToken: vi.fn(),
  saveOAuthTokens: vi.fn(),
  LinkedInApiError: class LinkedInApiError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "LinkedInApiError";
    }
  },
  LinkedInAuthError: class LinkedInAuthError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "LinkedInAuthError";
    }
  },
  SUPPORTED_IMAGE_TYPES: new Map([
    [".jpg", "image/jpeg"],
    [".jpeg", "image/jpeg"],
    [".png", "image/png"],
    [".gif", "image/gif"],
  ]),
}));

// Mock fs and fs/promises for file reads and stats
vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(true),
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockResolvedValue(Buffer.from("fake-image-bytes")),
  stat: vi.fn().mockResolvedValue({
    isFile: () => true,
    size: 2048,
  }),
}));

import { LinkedCtlPublisher, LinkedInAdapterError } from "./linkedctl-publisher.js";
import * as core from "@linkedctl/core";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";

const mockResolveConfig = core.resolveConfig as Mock;
const mockGetCurrentPersonUrn = core.getCurrentPersonUrn as Mock;
const mockGetUserInfo = core.getUserInfo as Mock;
const mockCreatePost = core.createPost as Mock;
const mockUploadImage = core.uploadImage as Mock;
const mockGetTokenExpiry = core.getTokenExpiry as Mock;
const mockReadFile = readFile as Mock;
const mockStat = stat as Mock;
const mockExistsSync = existsSync as Mock;

function setupAuthenticatedMock(): void {
  mockResolveConfig.mockResolvedValue({
    config: {
      oauth: {
        accessToken: "test-token-123",
        scope: "openid profile email w_member_social",
        tokenExpiresAt: "2099-01-01T00:00:00.000Z",
      },
      apiVersion: "202601",
    },
    warnings: [],
  });
  mockGetCurrentPersonUrn.mockResolvedValue("urn:li:person:abc123");
  mockGetUserInfo.mockResolvedValue({
    sub: "abc123",
    name: "Test User",
    given_name: "Test",
    family_name: "User",
    picture: "https://example.com/pic.jpg",
    email: "test@example.com",
  });
  mockGetTokenExpiry.mockReturnValue(undefined);
  mockExistsSync.mockReturnValue(true);
  mockStat.mockResolvedValue({ isFile: () => true, size: 2048 });
  mockReadFile.mockResolvedValue(Buffer.from("fake-image-data"));
}

describe("LinkedCtlPublisher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("preflightCheck", () => {
    it("returns preflight report on valid credentials", async () => {
      setupAuthenticatedMock();
      const publisher = new LinkedCtlPublisher();

      const report = await publisher.preflightCheck();

      expect(report.authenticated).toBe(true);
      expect(report.isExpired).toBe(false);
      expect(report.scopes.canPost).toBe(true);
      expect(report.identity?.name).toBe("Test User");
      expect(report.identity?.personUrn).toBe("urn:li:person:abc123");
    });

    it("detects missing w_member_social scope", async () => {
      mockResolveConfig.mockResolvedValue({
        config: {
          oauth: {
            accessToken: "test-token-123",
            scope: "openid profile email", // missing w_member_social
            tokenExpiresAt: "2099-01-01T00:00:00.000Z",
          },
          apiVersion: "202601",
        },
        warnings: [],
      });
      mockGetCurrentPersonUrn.mockResolvedValue("urn:li:person:abc123");
      mockGetUserInfo.mockResolvedValue({
        sub: "abc123",
        name: "Test User",
        email: "test@example.com",
      });

      const publisher = new LinkedCtlPublisher();
      const report = await publisher.preflightCheck();

      expect(report.authenticated).toBe(true);
      expect(report.scopes.canPost).toBe(false);
      expect(report.scopes.missing).toContain("w_member_social");
      expect(report.warning).toContain("w_member_social");
    });

    it("detects expired token without refresh capability", async () => {
      mockResolveConfig.mockResolvedValue({
        config: {
          oauth: {
            accessToken: "expired-token",
            scope: "openid profile email w_member_social",
            tokenExpiresAt: "2020-01-01T00:00:00.000Z", // in past
          },
          apiVersion: "202601",
        },
        warnings: [],
      });

      const publisher = new LinkedCtlPublisher();
      const report = await publisher.preflightCheck();

      expect(report.authenticated).toBe(false);
      expect(report.isExpired).toBe(true);
      expect(report.error).toContain("expired");
    });
  });

  describe("getAccount", () => {
    it("returns account info on success", async () => {
      setupAuthenticatedMock();
      const publisher = new LinkedCtlPublisher();

      const account = await publisher.getAccount();

      expect(account.sub).toBe("abc123");
      expect(account.name).toBe("Test User");
      expect(account.givenName).toBe("Test");
      expect(account.familyName).toBe("User");
      expect(account.email).toBe("test@example.com");
      expect(account.personUrn).toBe("urn:li:person:abc123");
    });

    it("throws LinkedInAdapterError on auth failure", async () => {
      mockResolveConfig.mockRejectedValue(new Error("No access token configured"));
      const publisher = new LinkedCtlPublisher();

      await expect(publisher.getAccount()).rejects.toThrow(LinkedInAdapterError);
    });
  });

  describe("publishText", () => {
    it("returns error for empty text", async () => {
      const publisher = new LinkedCtlPublisher();
      const result = await publisher.publishText({ text: "  " });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Post text cannot be empty");
    });

    it("creates a text post and returns normalized result", async () => {
      setupAuthenticatedMock();
      mockCreatePost.mockResolvedValue("urn:li:share:456789");

      const publisher = new LinkedCtlPublisher();
      const result = await publisher.publishText({ text: "Hello from automation!" });

      expect(result.success).toBe(true);
      expect(result.postUrn).toBe("urn:li:share:456789");
      expect(result.postId).toBe("456789");
      expect(result.postUrl).toBe("https://www.linkedin.com/feed/update/urn:li:share:456789");
      expect(result.error).toBeUndefined();
    });

    it("passes visibility and draft options", async () => {
      setupAuthenticatedMock();
      mockCreatePost.mockResolvedValue("urn:li:share:789");

      const publisher = new LinkedCtlPublisher();
      await publisher.publishText({
        text: "Draft post",
        visibility: "CONNECTIONS",
        draft: true,
      });

      expect(mockCreatePost).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          visibility: "CONNECTIONS",
          lifecycleState: "DRAFT",
        }),
      );
    });

    it("returns error on LinkedIn API failure", async () => {
      setupAuthenticatedMock();
      mockCreatePost.mockRejectedValue(new Error("API rate limit exceeded"));

      const publisher = new LinkedCtlPublisher();
      const result = await publisher.publishText({ text: "Test" });

      expect(result.success).toBe(false);
      expect(result.error).toContain("API rate limit exceeded");
    });
  });

  describe("publishImage", () => {
    it("returns error for empty text", async () => {
      const publisher = new LinkedCtlPublisher();
      const result = await publisher.publishImage({ text: "", imagePath: "/tmp/test.png" });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Post text cannot be empty");
    });

    it("uploads image and creates post with media attachment", async () => {
      setupAuthenticatedMock();
      mockReadFile.mockResolvedValue(Buffer.from("fake-image-data"));
      mockUploadImage.mockResolvedValue("urn:li:image:img123");
      mockCreatePost.mockResolvedValue("urn:li:share:999");

      const publisher = new LinkedCtlPublisher();
      const result = await publisher.publishImage({
        text: "Check out this image",
        imagePath: "/tmp/photo.png",
      });

      expect(result.success).toBe(true);
      expect(result.postUrn).toBe("urn:li:share:999");
      expect(mockUploadImage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          owner: "urn:li:person:abc123",
          contentType: "image/png",
        }),
      );
      expect(mockCreatePost).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          content: { media: { id: "urn:li:image:img123" } },
        }),
      );
    });

    it("returns error for unsupported image format", async () => {
      setupAuthenticatedMock();

      const publisher = new LinkedCtlPublisher();
      const result = await publisher.publishImage({
        text: "Image post",
        imagePath: "/tmp/photo.bmp",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Unsupported image");
    });

    it("returns error when image file is missing", async () => {
      setupAuthenticatedMock();
      mockExistsSync.mockReturnValue(false);

      const publisher = new LinkedCtlPublisher();
      const result = await publisher.publishImage({
        text: "Image post",
        imagePath: "/tmp/missing.png",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("does not exist");
    });
  });

  describe("profile support", () => {
    it("passes profile to resolveConfig", async () => {
      setupAuthenticatedMock();

      const publisher = new LinkedCtlPublisher("work");
      await publisher.getAccount();

      expect(mockResolveConfig).toHaveBeenCalledWith(expect.objectContaining({ profile: "work" }));
    });
  });
});
