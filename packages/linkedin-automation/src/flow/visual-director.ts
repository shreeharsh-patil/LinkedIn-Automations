// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * VisualDirector decides whether a post needs a generated visual
 * and creates appropriate prompts for Flow Agent image generation.
 *
 * For now only two visual types are supported:
 * - NONE: no image needed
 * - FLOW_IMAGE: generate via Flow Agent
 */

/**
 * Visual decision types.
 */
export type VisualType = "NONE" | "FLOW_IMAGE";

/**
 * Decision result from the VisualDirector.
 */
export interface VisualDecision {
  /** The chosen visual type. */
  type: VisualType;
  /** The image generation prompt (only set when type is FLOW_IMAGE). */
  prompt: string | undefined;
  /** Reason for the decision (for logging/debugging). */
  reason: string;
}

/**
 * Context about a post that the VisualDirector uses to make decisions.
 */
export interface PostContext {
  /** The post text/topic. */
  text: string;
  /** Optional technical context (e.g. "Rust async runtime", "PostgreSQL indexing"). */
  technicalContext?: string | undefined;
  /** Optional project name or repository. */
  project?: string | undefined;
}

/**
 * Prompt templates for different post categories.
 * Each template guides Flow Agent to produce technical editorial visuals
 * rather than generic AI art.
 */
const PROMPT_TEMPLATES: ReadonlyArray<{ match: RegExp; template: string }> = [
  {
    match: /\b(architecture|system design|microservice|infrastructure)\b/i,
    template:
      "Clean minimal technical architecture diagram on neutral background, " +
      "simple boxes and arrows showing system components, developer documentation aesthetic, " +
      "no text labels, dark background with subtle grid",
  },
  {
    match: /\b(bug|debug|fix|error|issue|crash|problem)\b/i,
    template:
      "Minimal technical illustration of debugging process, " +
      "clean terminal-style composition on dark background, " +
      "simple geometric shapes representing code flow, no text, developer aesthetic",
  },
  {
    match: /\b(performance|benchmark|speed|latency|optimization)\b/i,
    template:
      "Clean minimal chart illustration showing performance improvement, " +
      "simple bar or line chart on neutral background, " +
      "technical editorial style, no text labels, developer documentation aesthetic",
  },
  {
    match: /\b(release|launch|version|update|new)\b/i,
    template:
      "Clean minimal celebration illustration for software release, " +
      "abstract geometric confetti on neutral background, " +
      "subtle and professional, no text, developer aesthetic",
  },
  {
    match: /\b(security|auth|encrypt|token|vulnerability)\b/i,
    template:
      "Clean minimal security illustration, " +
      "simple shield or lock geometric shape on neutral background, " +
      "technical editorial style, no text, developer documentation aesthetic",
  },
];

/**
 * Default prompt for posts that don't match any specific template.
 */
const DEFAULT_PROMPT =
  "Clean minimal technical editorial illustration, " +
  "abstract geometric composition on neutral background, " +
  "simple shapes representing software concepts, " +
  "no text, no code, developer documentation aesthetic, " +
  "subtle and professional";

/**
 * Create a VisualDirector with default settings.
 */
export function createVisualDirector(): {
  decide: (context: PostContext) => VisualDecision;
} {
  return {
    decide: (context: PostContext): VisualDecision => {
      const text = context.text.trim();

      // Empty or very short posts don't need visuals
      if (text.length < 20) {
        return {
          type: "NONE",
          prompt: undefined,
          reason: "Post too short for a visual",
        };
      }

      // Posts with explicit "no image" markers
      if (/\b(no image|text only|no visual)\b/i.test(text)) {
        return {
          type: "NONE",
          prompt: undefined,
          reason: "Post explicitly requests no image",
        };
      }

      // Find matching prompt template
      const prompt = buildPrompt(context);

      return {
        type: "FLOW_IMAGE",
        prompt,
        reason: "Post suitable for technical editorial visual",
      };
    },
  };
}

/**
 * Build an image generation prompt from post context.
 */
function buildPrompt(context: PostContext): string {
  // Try to match a specific template
  const combined = `${context.text} ${context.technicalContext ?? ""} ${context.project ?? ""}`;

  for (const { match, template } of PROMPT_TEMPLATES) {
    if (match.test(combined)) {
      // Add project context if available
      if (context.project !== undefined && context.project !== "") {
        return `${template}, related to ${context.project} project`;
      }
      return template;
    }
  }

  // Use default prompt
  if (context.project !== undefined && context.project !== "") {
    return `${DEFAULT_PROMPT}, related to ${context.project} project`;
  }
  return DEFAULT_PROMPT;
}
