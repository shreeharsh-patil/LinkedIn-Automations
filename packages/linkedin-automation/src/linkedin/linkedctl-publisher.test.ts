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

// Mock fs/promises for file reads
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

import { LinkedCtlPublisher, LinkedInAdapterError } from "./linkedctl-publisher.js";
import * as core from "@linkedctl/core";
import { readFile } from "node:fs/promises";

const mockResolveConfig = core.resolveConfig as Mock;
const mockGetCurrentPersonUrn = core.getCurrentPersonUrn as Mock;
const mockGetUserInfo = core.getUserInfo as Mock;
const mockCreatePost = core.createPost as Mock;
const mockUploadImage = core.uploadImage as Mock;
const mockReadFile = readFile as Mock;

function setupAuthenticatedMock(): void {
  mockResolveConfig.mockResolvedValue({
    config: {
      oauth: { accessToken: "test-token-123" },
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
}

describe("LinkedCtlPublisher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      expect(result.error).toContain("Unsupported image format");
    });

    it("returns error when image file cannot be read", async () => {
      setupAuthenticatedMock();
      mockReadFile.mockRejectedValue(new Error("ENOENT: no such file"));

      const publisher = new LinkedCtlPublisher();
      const result = await publisher.publishImage({
        text: "Image post",
        imagePath: "/tmp/missing.png",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to read image file");
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
