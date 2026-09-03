// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock @linkedctl/core
vi.mock("@linkedctl/core", () => ({
  SUPPORTED_IMAGE_TYPES: new Map([
    [".jpg", "image/jpeg"],
    [".jpeg", "image/jpeg"],
    [".png", "image/png"],
    [".gif", "image/gif"],
  ]),
  resolveConfig: vi.fn(),
  LinkedInClient: vi.fn(),
  getCurrentPersonUrn: vi.fn(),
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
}));

// Mock the publisher to avoid real API calls — must be a class constructor
vi.mock("./linkedctl-publisher.js", () => {
  return {
    LinkedCtlPublisher: class MockLinkedCtlPublisher {
      publishText = vi.fn().mockResolvedValue({
        success: true,
        postId: "12345",
        postUrn: "urn:li:share:12345",
        postUrl: "https://www.linkedin.com/feed/update/urn:li:share:12345",
      });
      publishImage = vi.fn().mockResolvedValue({
        success: true,
        postId: "67890",
        postUrn: "urn:li:share:67890",
        postUrl: "https://www.linkedin.com/feed/update/urn:li:share:67890",
      });
    },
    LinkedInAdapterError: class LinkedInAdapterError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "LinkedInAdapterError";
      }
    },
  };
});

import {
  validateManualPost,
  formatPreview,
  publishManualPost,
  createManualPost,
  ManualPostError,
} from "./manual-post.js";

describe("validateManualPost", () => {
  it("rejects empty text", async () => {
    await expect(validateManualPost({ text: "" })).rejects.toThrow(ManualPostError);
    await expect(validateManualPost({ text: "" })).rejects.toThrow("cannot be empty");
  });

  it("rejects whitespace-only text", async () => {
    await expect(validateManualPost({ text: "   " })).rejects.toThrow(ManualPostError);
  });

  it("validates text-only post", async () => {
    const preview = await validateManualPost({ text: "Hello world" });

    expect(preview.text).toBe("Hello world");
    expect(preview.imagePath).toBeUndefined();
    expect(preview.imageContentType).toBeUndefined();
    expect(preview.imageSizeBytes).toBeUndefined();
    expect(preview.dryRun).toBe(false);
  });

  it("defaults dryRun to false", async () => {
    const preview = await validateManualPost({ text: "Test" });
    expect(preview.dryRun).toBe(false);
  });

  it("preserves dryRun flag", async () => {
    const preview = await validateManualPost({ text: "Test", dryRun: true });
    expect(preview.dryRun).toBe(true);
  });

  it("preserves altText", async () => {
    const preview = await validateManualPost({ text: "Test", altText: "My image" });
    expect(preview.altText).toBe("My image");
  });

  it("rejects unsupported image format", async () => {
    const dir = await mkdtemp(join(tmpdir(), "la-test-"));
    const filePath = join(dir, "photo.bmp");
    await writeFile(filePath, Buffer.alloc(10, 0));

    try {
      await expect(validateManualPost({ text: "Test", imagePath: filePath })).rejects.toThrow(
        "Unsupported image format",
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("rejects non-existent image file", async () => {
    await expect(validateManualPost({ text: "Test", imagePath: "/tmp/nonexistent.png" })).rejects.toThrow("not found");
  });

  it("accepts valid PNG image", async () => {
    const dir = await mkdtemp(join(tmpdir(), "la-test-"));
    const filePath = join(dir, "test.png");
    await writeFile(filePath, Buffer.alloc(100, 0x89));

    try {
      const preview = await validateManualPost({ text: "Test", imagePath: filePath });

      expect(preview.imagePath).toBe(filePath);
      expect(preview.imageContentType).toBe("image/png");
      expect(preview.imageSizeBytes).toBe(100);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("accepts valid JPEG image", async () => {
    const dir = await mkdtemp(join(tmpdir(), "la-test-"));
    const filePath = join(dir, "photo.jpg");
    await writeFile(filePath, Buffer.alloc(200, 0xff));

    try {
      const preview = await validateManualPost({ text: "Test", imagePath: filePath });

      expect(preview.imageContentType).toBe("image/jpeg");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("rejects image exceeding 5 MB", async () => {
    const dir = await mkdtemp(join(tmpdir(), "la-test-"));
    const filePath = join(dir, "huge.png");
    const sixMB = 6 * 1024 * 1024;
    await writeFile(filePath, Buffer.alloc(sixMB, 0x89));

    try {
      await expect(validateManualPost({ text: "Test", imagePath: filePath })).rejects.toThrow("exceeds the 5 MB limit");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("accepts image at exactly 5 MB", async () => {
    const dir = await mkdtemp(join(tmpdir(), "la-test-"));
    const filePath = join(dir, "exact.png");
    const fiveMB = 5 * 1024 * 1024;
    await writeFile(filePath, Buffer.alloc(fiveMB, 0x89));

    try {
      const preview = await validateManualPost({ text: "Test", imagePath: filePath });
      expect(preview.imageSizeBytes).toBe(fiveMB);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("rejects directory path as image", async () => {
    const dir = await mkdtemp(join(tmpdir(), "la-test-"));

    try {
      await expect(validateManualPost({ text: "Test", imagePath: join(dir, "missing.png") })).rejects.toThrow(
        "not found",
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

describe("formatPreview", () => {
  it("formats text-only preview", () => {
    const preview = {
      text: "Hello world",
      imagePath: undefined,
      imageContentType: undefined,
      imageSizeBytes: undefined,
      altText: undefined,
      dryRun: false,
    };

    const output = formatPreview(preview);
    expect(output).toContain("LinkedIn Post Preview");
    expect(output).toContain("Hello world");
    expect(output).toContain("(none)");
    expect(output).toContain("Ready to publish");
  });

  it("formats image preview with size", () => {
    const preview = {
      text: "Check this out",
      imagePath: "/tmp/photo.png",
      imageContentType: "image/png",
      imageSizeBytes: 1024,
      altText: undefined,
      dryRun: false,
    };

    const output = formatPreview(preview);
    expect(output).toContain("/tmp/photo.png");
    expect(output).toContain("image/png");
    expect(output).toContain("1 KB");
  });

  it("formats dry run preview", () => {
    const preview = {
      text: "Test post",
      imagePath: undefined,
      imageContentType: undefined,
      imageSizeBytes: undefined,
      altText: undefined,
      dryRun: true,
    };

    const output = formatPreview(preview);
    expect(output).toContain("DRY RUN");
    expect(output).not.toContain("Ready to publish");
  });

  it("shows alt text when provided", () => {
    const preview = {
      text: "Test",
      imagePath: "/tmp/photo.png",
      imageContentType: "image/png",
      imageSizeBytes: 1024,
      altText: "A beautiful sunset",
      dryRun: false,
    };

    const output = formatPreview(preview);
    expect(output).toContain("A beautiful sunset");
  });
});

describe("publishManualPost", () => {
  it("publishes text-only post", async () => {
    const preview = {
      text: "Hello LinkedIn",
      imagePath: undefined,
      imageContentType: undefined,
      imageSizeBytes: undefined,
      altText: undefined,
      dryRun: false,
    };

    const result = await publishManualPost(preview);

    expect(result.success).toBe(true);
    expect(result.postUrn).toBe("urn:li:share:12345");
  });

  it("publishes image post", async () => {
    const preview = {
      text: "Check this image",
      imagePath: "/tmp/photo.png",
      imageContentType: "image/png",
      imageSizeBytes: 1024,
      altText: undefined,
      dryRun: false,
    };

    const result = await publishManualPost(preview);

    expect(result.success).toBe(true);
    expect(result.postUrn).toBe("urn:li:share:67890");
  });
});

describe("createManualPost", () => {
  it("returns preview without result on dry run", async () => {
    const { preview, result } = await createManualPost({
      text: "Dry run test",
      dryRun: true,
    });

    expect(preview.text).toBe("Dry run test");
    expect(preview.dryRun).toBe(true);
    expect(result).toBeUndefined();
  });

  it("returns preview and result when publishing", async () => {
    const { preview, result } = await createManualPost({
      text: "Real post",
      dryRun: false,
    });

    expect(preview.text).toBe("Real post");
    expect(result).toBeDefined();
    expect(result?.success).toBe(true);
  });
});
