// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";

import { createVisualDirector } from "./visual-director.js";

describe("createVisualDirector", () => {
  const director = createVisualDirector();

  describe("decide", () => {
    it("returns NONE for very short posts", () => {
      const result = director.decide({ text: "Hello" });
      expect(result.type).toBe("NONE");
      expect(result.reason).toContain("short");
    });

    it("returns NONE when text explicitly says no image", () => {
      const result = director.decide({ text: "This is a longer post about something no image needed here at all" });
      expect(result.type).toBe("NONE");
      expect(result.reason).toContain("explicitly");
    });

    it("returns FLOW_IMAGE for architecture posts", () => {
      const result = director.decide({
        text: "I just redesigned the architecture of our microservice system to improve scalability",
        technicalContext: "microservice architecture",
      });
      expect(result.type).toBe("FLOW_IMAGE");
      expect(result.prompt).toContain("architecture");
    });

    it("returns FLOW_IMAGE for bug fix posts", () => {
      const result = director.decide({
        text: "Found and fixed a tricky concurrency bug in our async runtime that was causing random crashes",
      });
      expect(result.type).toBe("FLOW_IMAGE");
      expect(result.prompt).toContain("debugging");
    });

    it("returns FLOW_IMAGE for performance posts", () => {
      const result = director.decide({
        text: "Ran benchmarks on the new query optimizer and achieved 3x performance improvement on large datasets",
      });
      expect(result.type).toBe("FLOW_IMAGE");
      expect(result.prompt).toContain("performance");
    });

    it("returns FLOW_IMAGE for release posts", () => {
      const result = director.decide({
        text: "Excited to announce the release of version 2.0 with major new features and improvements",
      });
      expect(result.type).toBe("FLOW_IMAGE");
      expect(result.prompt).toContain("release");
    });

    it("returns FLOW_IMAGE for security posts", () => {
      const result = director.decide({
        text: "Implemented OAuth2 token encryption for all stored credentials in the authentication system",
      });
      expect(result.type).toBe("FLOW_IMAGE");
      expect(result.prompt).toContain("security");
    });

    it("uses default prompt for unmatched posts", () => {
      const result = director.decide({
        text: "Today I learned something interesting about TypeScript generics and conditional types",
      });
      expect(result.type).toBe("FLOW_IMAGE");
      expect(result.prompt).toContain("technical editorial");
    });

    it("includes project context in prompt", () => {
      const result = director.decide({
        text: "Refactored the database connection pooling for better performance under load",
        project: "linkedctl",
      });
      expect(result.type).toBe("FLOW_IMAGE");
      expect(result.prompt).toContain("linkedctl");
    });
  });
});
