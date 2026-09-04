#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { createInterface } from "node:readline/promises";

import { runPipeline } from "./agents/pipeline.js";

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case "draft":
      runDraft(args.slice(1));
      break;
    case "discover":
      await runDiscover(args.slice(1));
      break;
    case "prepare":
      await runPrepare(args.slice(1));
      break;
    case "manual":
      await runManual(args.slice(1));
      break;
    case "schedule":
      await runSchedule(args.slice(1));
      break;
    case "queue":
      await runQueue(args.slice(1));
      break;
    case "run-worker":
      await runWorker(args.slice(1));
      break;
    case "list":
      await runList(args.slice(1));
      break;
    case "view":
      await runView(args.slice(1));
      break;
    case "approve":
      await runApprove(args.slice(1));
      break;
    case "edit":
      await runEdit(args.slice(1));
      break;
    case "reject":
    case "skip":
      await runReject(args.slice(1));
      break;
    case "post-now":
      await runPostNow(args.slice(1));
      break;
    case "flow-status":
      await runFlowStatus(args.slice(1));
      break;
    case "--help":
    case "-h":
    case "help":
      printGlobalUsage();
      break;
    default:
      if (command === undefined) {
        printGlobalUsage();
      } else {
        console.error(`Unknown command: ${command}`);
        console.error("Run with --help for usage information.");
        process.exit(2);
      }
      break;
  }
}

function printGlobalUsage(): void {
  console.log(`linkedin-auto — LinkedIn content automation CLI

Usage:
  linkedin-auto <command> [options]

Commands:
  manual      Create and publish a LinkedIn post manually
  draft       Generate a LinkedIn post draft from technical context
  discover    Analyze GitHub activity and find content candidates
  prepare     Discover, analyze, and draft posts from GitHub activity
  schedule    Schedule an approved draft for publishing
  queue       Show the publishing queue
  run-worker  Start the automated publishing worker
  flow-status Check Flow Agent connection and image generation readiness
  --help      Show this help message

Run 'linkedin-auto <command> --help' for command-specific help.`);
}

/**
 * Parse draft command arguments.
 */
function parseDraftArgs(argv: string[]): {
  context: string | undefined;
  maxWords: number | undefined;
  noHashtags: boolean;
  help: boolean;
} {
  let context: string | undefined;
  let maxWords: number | undefined;
  let noHashtags = false;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    switch (arg) {
      case "--context":
        context = argv[++i];
        break;
      case "--max-words":
        maxWords = Number.parseInt(argv[++i] ?? "", 10);
        break;
      case "--no-hashtags":
        noHashtags = true;
        break;
      case "--help":
      case "-h":
        help = true;
        break;
      default:
        if (context === undefined && !arg.startsWith("--")) {
          context = arg;
        }
        break;
    }
  }

  return { context, maxWords, noHashtags, help };
}

function printDraftUsage(): void {
  console.log(`linkedin-auto draft — Generate a LinkedIn post draft from technical context

Usage:
  linkedin-auto draft --context "your technical context"

Options:
  --context <text>     Technical context to generate from (required)
  --max-words <n>      Maximum word count (default: 300)
  --no-hashtags        Exclude hashtags
  -h, --help           Show this help message

Examples:
  linkedin-auto draft --context "Built a Redis caching layer that reduced API latency by 3x"
  linkedin-auto draft --context "Migrated from Express to Fastify" --max-words 200`);
}

/**
 * Run the draft command.
 */
function runDraft(argv: string[]): void {
  const args = parseDraftArgs(argv);

  if (args.help) {
    printDraftUsage();
    return;
  }

  if (args.context === undefined || args.context.trim() === "") {
    console.error('Error: Context is required. Use --context "your technical context".');
    console.error("Run with --help for usage information.");
    process.exit(2);
  }

  console.error("Extracting facts...\n");

  const result = runPipeline(args.context, {
    maxWords: args.maxWords,
    includeHashtags: !args.noHashtags,
  });

  // Output structured results
  console.log("═══════════════════════════════════════════");
  console.log("  FACTS");
  console.log("═══════════════════════════════════════════");
  for (const fact of result.facts) {
    console.log(`  [${fact.id}] ${fact.claim} (confidence: ${fact.confidence})`);
  }
  if (result.facts.length === 0) {
    console.log("  (no facts extracted)");
  }

  console.log("\n═══════════════════════════════════════════");
  console.log("  DRAFT");
  console.log("═══════════════════════════════════════════");
  if (result.draft.text !== "") {
    console.log(result.draft.text);
    console.log(`\n  (${result.draft.wordCount} words)`);
  } else {
    console.log("  (no draft generated)");
  }

  console.log("\n═══════════════════════════════════════════");
  console.log("  SLOP GUARD");
  console.log("═══════════════════════════════════════════");
  console.log(`  Score: ${result.slop.score}/100 (lower is better)`);
  console.log(`  ${result.slop.summary}`);
  for (const v of result.slop.violations) {
    console.log(`  [${v.severity}] "${v.phrase}" — ${v.suggestion}`);
  }

  console.log("\n═══════════════════════════════════════════");
  console.log("  CLAIM VERIFICATION");
  console.log("═══════════════════════════════════════════");
  console.log(`  ${result.claims.summary}`);
  for (const c of result.claims.claims) {
    console.log(`  [${c.status}] ${c.claim}`);
    if (c.status !== "SUPPORTED") {
      console.log(`    → ${c.explanation}`);
    }
  }

  console.log("\n═══════════════════════════════════════════");
  console.log("  FINAL POST");
  console.log("═══════════════════════════════════════════");
  console.log(`  Decision: ${result.review.decision}`);
  console.log(`  Score: ${result.review.score}/100`);
  if (result.finalPost !== "") {
    console.log(`\n${result.finalPost}`);
  } else {
    console.log("\n  (post rejected — too many issues)");
  }

  if (result.review.suggestions.length > 0) {
    console.log("\n  Suggestions:");
    for (const s of result.review.suggestions) {
      console.log(`    • ${s}`);
    }
  }

  console.log("");
}

/**
 * Parse manual command arguments.
 */
function parseManualArgs(argv: string[]): {
  text: string | undefined;
  imagePath: string | undefined;
  altText: string | undefined;
  dryRun: boolean;
  profile: string | undefined;
  generateVisual: boolean;
  technicalContext: string | undefined;
  help: boolean;
} {
  let text: string | undefined;
  let imagePath: string | undefined;
  let altText: string | undefined;
  let dryRun = false;
  let profile: string | undefined;
  let generateVisual = false;
  let technicalContext: string | undefined;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    switch (arg) {
      case "--text":
        text = argv[++i];
        break;
      case "--image":
        imagePath = argv[++i];
        break;
      case "--alt":
        altText = argv[++i];
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--profile":
        profile = argv[++i];
        break;
      case "--generate-visual":
        generateVisual = true;
        break;
      case "--technical-context":
        technicalContext = argv[++i];
        break;
      case "--help":
      case "-h":
        help = true;
        break;
      default:
        if (text === undefined && !arg.startsWith("--")) {
          text = arg;
        }
        break;
    }
  }

  return { text, imagePath, altText, dryRun, profile, generateVisual, technicalContext, help };
}

function printManualUsage(): void {
  console.log(`linkedin-auto manual — Create and publish a LinkedIn post manually

Usage:
  linkedin-auto manual --text "Your post text" [options]
  linkedin-auto manual "Your post text" [options]

Options:
  --text <text>              Post text content (or pass as positional argument)
  --image <path>             Local image file path (JPG, PNG, or GIF)
  --alt <text>               Alt text for the image (informational only)
  --generate-visual          Generate an image via Flow Agent
  --technical-context <ctx>  Technical context for visual generation
  --dry-run                  Show preview without publishing
  --profile <name>           LinkedIn profile name from linkedctl config
  -h, --help                 Show this help message

Examples:
  linkedin-auto manual --text "Hello from automation" --dry-run
  linkedin-auto manual --text "Check this out" --image ./photo.png
  linkedin-auto manual --text "Built a new feature" --generate-visual
  linkedin-auto manual "Testing my automation" --dry-run`);
}

/**
 * Run the manual command.
 */
async function runManual(argv: string[]): Promise<void> {
  const args = parseManualArgs(argv);

  if (args.help) {
    printManualUsage();
    return;
  }

  if (args.text === undefined || args.text.trim() === "") {
    console.error('Error: Post text is required. Use --text "your message" or pass text as an argument.');
    console.error("Run with --help for usage information.");
    process.exit(2);
  }

  // Lazy import to avoid loading LinkedIn modules when only using draft
  const { validateManualPost, formatPreview, ManualPostError } = await import("./linkedin/manual-post.js");
  const { LinkedInAdapterError } = await import("./linkedin/linkedctl-publisher.js");
  const { loadConfig } = await import("./config/config.js");

  // Validate
  let preview;
  try {
    const automationConfig = args.generateVisual ? loadConfig() : undefined;
    preview = await validateManualPost({
      text: args.text,
      imagePath: args.imagePath,
      altText: args.altText,
      dryRun: args.dryRun,
      profile: args.profile,
      generateVisual: args.generateVisual,
      technicalContext: args.technicalContext,
      automationConfig,
    });
  } catch (error: unknown) {
    if (error instanceof ManualPostError) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }

  // Show preview
  console.error(formatPreview(preview));
  console.error("");

  // Dry run — stop here
  if (preview.dryRun) {
    return;
  }

  // Require confirmation before publishing
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  let confirmed: boolean;
  try {
    const answer = await rl.question("Publish this post to LinkedIn? [y/N] ");
    confirmed = answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }

  if (!confirmed) {
    console.error("Aborted.");
    return;
  }

  // Publish
  console.error("Publishing...");
  try {
    const { createManualPost } = await import("./linkedin/manual-post.js");
    const { result } = await createManualPost({
      text: args.text,
      imagePath: args.imagePath,
      altText: args.altText,
      dryRun: false,
      profile: args.profile,
    });

    if (result?.success === true) {
      console.error("Published successfully!");
      if (result.postUrl !== undefined) {
        console.error(`URL: ${result.postUrl}`);
      }
      if (result.postUrn !== undefined) {
        console.error(`URN: ${result.postUrn}`);
      }
    } else {
      console.error(`Publish failed: ${result?.error ?? "Unknown error"}`);
      process.exit(1);
    }
  } catch (error: unknown) {
    if (error instanceof LinkedInAdapterError) {
      console.error(`Error: ${error.message}`);
    } else if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error("Error: Unknown error occurred");
    }
    process.exit(1);
  }
}

/**
 * Parse discover command arguments.
 */
function parseDiscoverArgs(argv: string[]): {
  repo: string | undefined;
  days: number;
  threshold: number;
  help: boolean;
} {
  let repo: string | undefined;
  let days = 7;
  let threshold = 5;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    switch (arg) {
      case "--repo":
        repo = argv[++i];
        break;
      case "--days":
        days = Number.parseInt(argv[++i] ?? "7", 10);
        break;
      case "--threshold":
        threshold = Number.parseInt(argv[++i] ?? "5", 10);
        break;
      case "--help":
      case "-h":
        help = true;
        break;
      default:
        if (repo === undefined && !arg.startsWith("--")) {
          repo = arg;
        }
        break;
    }
  }

  return { repo, days, threshold, help };
}

function printDiscoverUsage(): void {
  console.log(`linkedin-auto discover — Analyze GitHub activity and find content candidates

Usage:
  linkedin-auto discover owner/repo [options]
  linkedin-auto discover --repo owner/repo [options]

Options:
  --repo <owner/repo>   GitHub repository (required)
  --days <n>            Lookback period in days (default: 7)
  --threshold <n>       Minimum score threshold (default: 5)
  -h, --help            Show this help message

Environment:
  GITHUB_TOKEN          GitHub personal access token (optional, for private repos)

Examples:
  linkedin-auto discover shreeharsh-patil/LinkedIn-Automations
  linkedin-auto discover --repo owner/repo --days 14
  linkedin-auto discover owner/repo --threshold 3`);
}

/**
 * Run the discover command.
 */
async function runDiscover(argv: string[]): Promise<void> {
  const args = parseDiscoverArgs(argv);

  if (args.help) {
    printDiscoverUsage();
    return;
  }

  if (args.repo === undefined || args.repo.trim() === "") {
    console.error("Error: Repository is required. Use owner/repo format.");
    console.error("Run with --help for usage information.");
    process.exit(2);
  }

  const repoParts = args.repo.split("/");
  if (repoParts.length !== 2 || repoParts[0] === "" || repoParts[1] === "") {
    console.error("Error: Repository must be in owner/repo format (e.g. shreeharsh-patil/LinkedIn-Automations)");
    process.exit(2);
  }

  const owner = repoParts[0] ?? "";
  const repo = repoParts[1] ?? "";

  console.error(`Analyzing ${owner}/${repo} (last ${args.days} days)...\n`);

  const { analyzeRepository } = await import("./sources/github/repository-analyzer.js");
  const { GitHubClient } = await import("./sources/github/github-client.js");

  // Check auth
  const client = new GitHubClient();
  if (!client.isAuthenticated()) {
    console.error("Warning: No GITHUB_TOKEN set. Only public data will be accessible.");
    console.error("");
  }

  try {
    const candidates = await analyzeRepository(owner, repo, {
      lookbackDays: args.days,
      scoreThreshold: args.threshold,
    });

    if (candidates.length === 0) {
      console.log("No content candidates found.");
      console.log("");
      console.log("Try:");
      console.log("  • Increasing --days to look further back");
      console.log("  • Lowering --threshold to include lower-scored activity");
      console.log("  • Checking a different repository");
      return;
    }

    console.log(`Found ${candidates.length} candidate(s):\n`);

    for (const candidate of candidates) {
      console.log("═══════════════════════════════════════════");
      console.log(`  ${candidate.title}`);
      console.log("═══════════════════════════════════════════");
      console.log(`  Repository: ${candidate.repo}`);
      console.log(`  Source:     ${candidate.source}`);
      console.log(`  Score:      ${candidate.score}`);
      console.log(`  Why:        ${candidate.reason}`);
      console.log("");
      if (candidate.facts.length > 0) {
        console.log("  Facts:");
        for (const fact of candidate.facts) {
          console.log(`    • ${fact}`);
        }
      }
      if (candidate.supportingFiles.length > 0) {
        console.log("");
        console.log("  Files:");
        for (const file of candidate.supportingFiles.slice(0, 5)) {
          console.log(`    ${file}`);
        }
      }
      if (candidate.supportingCommits.length > 0) {
        console.log("");
        console.log(`  Commits: ${candidate.supportingCommits.length}`);
      }
      console.log("");
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

/**
 * Parse prepare command arguments.
 */
function parsePrepareArgs(argv: string[]): {
  repo: string | undefined;
  days: number;
  threshold: number;
  maxWords: number | undefined;
  noHashtags: boolean;
  help: boolean;
} {
  let repo: string | undefined;
  let days = 7;
  let threshold = 5;
  let maxWords: number | undefined;
  let noHashtags = false;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    switch (arg) {
      case "--repo":
        repo = argv[++i];
        break;
      case "--days":
        days = Number.parseInt(argv[++i] ?? "7", 10);
        break;
      case "--threshold":
        threshold = Number.parseInt(argv[++i] ?? "5", 10);
        break;
      case "--max-words":
        maxWords = Number.parseInt(argv[++i] ?? "", 10);
        break;
      case "--no-hashtags":
        noHashtags = true;
        break;
      case "--help":
      case "-h":
        help = true;
        break;
      default:
        if (repo === undefined && !arg.startsWith("--")) {
          repo = arg;
        }
        break;
    }
  }

  return { repo, days, threshold, maxWords, noHashtags, help };
}

function printPrepareUsage(): void {
  console.log(`linkedin-auto prepare — Discover, analyze, and draft posts from GitHub activity

Usage:
  linkedin-auto prepare owner/repo [options]
  linkedin-auto prepare --repo owner/repo [options]

Options:
  --repo <owner/repo>   GitHub repository (required)
  --days <n>            Lookback period in days (default: 7)
  --threshold <n>       Minimum score threshold (default: 5)
  --max-words <n>       Maximum words per draft (default: 300)
  --no-hashtags         Exclude hashtags from drafts
  -h, --help            Show this help message

Environment:
  GITHUB_TOKEN          GitHub personal access token (optional, for private repos)

Examples:
  linkedin-auto prepare shreeharsh-patil/LinkedIn-Automations
  linkedin-auto prepare owner/repo --days 14 --threshold 3`);
}

/**
 * Run the prepare command.
 */
async function runPrepare(argv: string[]): Promise<void> {
  const args = parsePrepareArgs(argv);

  if (args.help) {
    printPrepareUsage();
    return;
  }

  if (args.repo === undefined || args.repo.trim() === "") {
    console.error("Error: Repository is required. Use owner/repo format.");
    console.error("Run with --help for usage information.");
    process.exit(2);
  }

  const repoParts = args.repo.split("/");
  if (repoParts.length !== 2 || repoParts[0] === "" || repoParts[1] === "") {
    console.error("Error: Repository must be in owner/repo format (e.g. shreeharsh-patil/LinkedIn-Automations)");
    process.exit(2);
  }

  const owner = repoParts[0] ?? "";
  const repo = repoParts[1] ?? "";

  console.error(`Preparing content from ${owner}/${repo} (last ${args.days} days)...\n`);

  const { runPreparePipeline } = await import("./pipeline/prepare-pipeline.js");
  const { GitHubClient } = await import("./sources/github/github-client.js");

  // Check auth
  const client = new GitHubClient();
  if (!client.isAuthenticated()) {
    console.error("Warning: No GITHUB_TOKEN set. Only public data will be accessible.");
    console.error("");
  }

  try {
    const drafts = await runPreparePipeline(owner, repo, {
      lookbackDays: args.days,
      scoreThreshold: args.threshold,
      maxWords: args.maxWords,
      includeHashtags: !args.noHashtags,
    });

    if (drafts.length === 0) {
      console.log("No content candidates found.");
      console.log("");
      console.log("Try:");
      console.log("  • Increasing --days to look further back");
      console.log("  • Lowering --threshold to include lower-scored activity");
      console.log("  • Checking a different repository");
      return;
    }

    console.log(`Found ${drafts.length} candidate(s):\n`);

    for (const prepared of drafts) {
      console.log("═══════════════════════════════════════════");
      console.log(`  ${prepared.candidate.title}`);
      console.log("═══════════════════════════════════════════");
      console.log(`  Repository: ${prepared.candidate.repo}`);
      console.log(`  Score:      ${prepared.candidate.score}`);
      console.log(`  Status:     ${prepared.status}`);
      console.log(`  Why:        ${prepared.candidate.reason}`);
      console.log("");

      // Facts
      console.log("  Facts:");
      for (const fact of prepared.facts.slice(0, 5)) {
        console.log(`    [${fact.id}] ${fact.claim}`);
      }
      console.log("");

      // Draft
      console.log("  Draft:");
      if (prepared.finalPost !== "") {
        const lines = prepared.finalPost.split("\n");
        for (const line of lines) {
          console.log(`    ${line}`);
        }
      } else {
        console.log("    (no draft generated)");
      }
      console.log("");

      // Quality checks
      console.log("  Quality:");
      console.log(`    Slop score: ${prepared.slopResult.score}/100`);
      console.log(`    ${prepared.slopResult.summary}`);
      console.log(`    ${prepared.verification.summary}`);
      console.log(`    Review: ${prepared.review.decision} (${prepared.review.score}/100)`);
      console.log("");

      if (prepared.review.suggestions.length > 0) {
        console.log("  Suggestions:");
        for (const s of prepared.review.suggestions) {
          console.log(`    • ${s}`);
        }
        console.log("");
      }
    }

    // Summary
    const approved = drafts.filter((d) => d.status === "APPROVED").length;
    const reviewRequired = drafts.filter((d) => d.status === "REVIEW_REQUIRED").length;
    const skipped = drafts.filter((d) => d.status === "SKIPPED").length;

    console.log("═══════════════════════════════════════════");
    console.log("  SUMMARY");
    console.log("═══════════════════════════════════════════");
    console.log(`  Approved:        ${approved}`);
    console.log(`  Needs revision:  ${reviewRequired}`);
    console.log(`  Skipped:         ${skipped}`);
    console.log("");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

// ─── Schedule Command ─────────────────────────────────────────

/**
 * Parse schedule command arguments.
 */
function parseScheduleArgs(argv: string[]): {
  draftId: number | undefined;
  time: string | undefined;
  days: string | undefined;
  timezone: string | undefined;
  help: boolean;
} {
  let draftId: number | undefined;
  let time: string | undefined;
  let days: string | undefined;
  let timezone: string | undefined;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    switch (arg) {
      case "--draft":
        draftId = Number.parseInt(argv[++i] ?? "", 10);
        break;
      case "--time":
        time = argv[++i];
        break;
      case "--days":
        days = argv[++i];
        break;
      case "--timezone":
        timezone = argv[++i];
        break;
      case "--help":
      case "-h":
        help = true;
        break;
      default:
        if (draftId === undefined && !arg.startsWith("--")) {
          draftId = Number.parseInt(arg, 10);
        }
        break;
    }
  }

  return { draftId, time, days, timezone, help };
}

function printScheduleUsage(): void {
  console.log(`linkedin-auto schedule — Schedule an approved draft for publishing

Usage:
  linkedin-auto schedule <draft-id> [options]

Options:
  --draft <id>        Draft ID to schedule (or pass as positional argument)
  --time <HH:MM>      Publish time (default: from POST_TIME env or 10:00)
  --days <DAYS>       Publish days, e.g. MON,WED,FRI (default: from POST_DAYS env)
  --timezone <tz>     Timezone, e.g. Asia/Kolkata (default: from POST_TIMEZONE env)
  -h, --help          Show this help message

Environment:
  POST_DAYS           Comma-separated day abbreviations (default: MON,WED,FRI)
  POST_TIME           Publish time in HH:MM format (default: 10:00)
  POST_TIMEZONE       IANA timezone name (default: Asia/Kolkata)
  LINKEDCTL_DB_PATH   Path to SQLite database (default: ./linkedin-automation.db)

Examples:
  linkedin-auto schedule 42
  linkedin-auto schedule 42 --time 14:30 --days TUE,THU
  linkedin-auto schedule --draft 42 --timezone America/New_York`);
}

/**
 * Run the schedule command.
 */
async function runSchedule(argv: string[]): Promise<void> {
  const args = parseScheduleArgs(argv);

  if (args.help) {
    printScheduleUsage();
    return;
  }

  if (args.draftId === undefined || Number.isNaN(args.draftId)) {
    console.error("Error: Draft ID is required.");
    console.error("Run with --help for usage information.");
    process.exit(2);
  }

  const { SqliteStorage: SqliteStorageClass } = await import("./storage/sqlite-storage.js");
  const { loadScheduleConfig, calculateNextPublishTime, parsePostDays, validatePostTime, validateTimezone } =
    await import("./scheduler/schedule.js");

  const dbPath = process.env["LINKEDCTL_DB_PATH"] ?? "./linkedin-automation.db";
  const storage = new SqliteStorageClass(dbPath);
  storage.initialize();

  try {
    // Load schedule config from env, override with CLI args
    const envConfig = loadScheduleConfig();
    const scheduleConfig = {
      postDays: args.days !== undefined ? parsePostDays(args.days) : envConfig.postDays,
      postTime: args.time !== undefined ? validatePostTime(args.time) : envConfig.postTime,
      postTimezone: args.timezone !== undefined ? validateTimezone(args.timezone) : envConfig.postTimezone,
    };

    // Get the draft
    const draft = storage.getDraft(args.draftId);
    if (draft === undefined) {
      console.error(`Error: Draft #${args.draftId} not found.`);
      process.exit(1);
    }

    if (draft.state !== "APPROVED") {
      console.error(`Error: Draft #${args.draftId} is not in APPROVED state (current: ${draft.state}).`);
      process.exit(1);
    }

    // Calculate next publish time
    const nextPublishTime = calculateNextPublishTime(scheduleConfig);

    // Create scheduled post
    const now = new Date().toISOString();
    const scheduledId = storage.insertScheduledPost({
      draftId: args.draftId,
      scheduledAt: nextPublishTime.toISOString(),
      lockId: undefined,
      lockExpiresAt: undefined,
      state: "SCHEDULED",
      createdAt: now,
      updatedAt: now,
    });

    // Update draft state
    storage.updateDraftState(args.draftId, "SCHEDULED");

    console.log("═══════════════════════════════════════════");
    console.log("  SCHEDULED");
    console.log("═══════════════════════════════════════════");
    console.log(`  Draft:     #${args.draftId}`);
    console.log(`  Scheduled: #${scheduledId}`);
    console.log(`  Publish at: ${nextPublishTime.toISOString()}`);
    console.log(`  Days:      ${scheduleConfig.postDays.join(", ")}`);
    console.log(`  Time:      ${scheduleConfig.postTime}`);
    console.log(`  Timezone:  ${scheduleConfig.postTimezone}`);
    console.log("");
  } finally {
    storage.close();
  }
}

// ─── Queue Command ───────────────────────────────────────────

/**
 * Parse queue command arguments.
 */
function parseQueueArgs(argv: string[]): {
  help: boolean;
} {
  let help = false;

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      help = true;
    }
  }

  return { help };
}

function printQueueUsage(): void {
  console.log(
    "linkedin-auto queue — Show the publishing queue\n" +
      "\n" +
      "Usage:\n" +
      "  linkedin-auto queue [options]\n" +
      "\n" +
      "Options:\n" +
      "  -h, --help    Show this help message\n" +
      "\n" +
      "Environment:\n" +
      "  LINKEDCTL_DB_PATH   Path to SQLite database (default: ./linkedin-automation.db)\n" +
      "\n" +
      "Examples:\n" +
      "  linkedin-auto queue",
  );
}

/**
 * Run the queue command.
 */
async function runQueue(argv: string[]): Promise<void> {
  const args = parseQueueArgs(argv);

  if (args.help) {
    printQueueUsage();
    return;
  }

  const { SqliteStorage: SqliteStorageClass } = await import("./storage/sqlite-storage.js");

  const dbPath = process.env["LINKEDCTL_DB_PATH"] ?? "./linkedin-automation.db";
  const storage = new SqliteStorageClass(dbPath);
  storage.initialize();

  try {
    const publishedPosts = storage.getAllPublishedPosts();

    console.log("═══════════════════════════════════════════");
    console.log("  PUBLISHING QUEUE");
    console.log("═══════════════════════════════════════════");
    console.log("");

    // Show published posts
    if (publishedPosts.length > 0) {
      console.log(`  Published posts (${publishedPosts.length}):`);
      for (const post of publishedPosts.slice(0, 10)) {
        const draft = storage.getDraft(post.draftId);
        const preview = draft?.text.slice(0, 60) ?? "(unknown)";
        console.log(`    #${post.id} | ${post.publishedAt.slice(0, 16)} | ${preview}...`);
        console.log(`           | ${post.linkedinPostUrl}`);
      }
      if (publishedPosts.length > 10) {
        console.log(`    ... and ${publishedPosts.length - 10} more`);
      }
    } else {
      console.log("  No published posts yet.");
    }

    console.log("");
    console.log("═══════════════════════════════════════════");
  } finally {
    storage.close();
  }
}

// ─── Run Worker Command ──────────────────────────────────────

/**
 * Parse run-worker command arguments.
 */
function parseWorkerArgs(argv: string[]): {
  interval: number;
  help: boolean;
} {
  let interval = 60;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    switch (arg) {
      case "--interval":
        interval = Number.parseInt(argv[++i] ?? "60", 10);
        break;
      case "--help":
      case "-h":
        help = true;
        break;
    }
  }

  return { interval, help };
}

function printWorkerUsage(): void {
  console.log(
    "linkedin-auto run-worker \u2014 Start the automated publishing worker\n" +
      "\n" +
      "Usage:\n" +
      "  linkedin-auto run-worker [options]\n" +
      "\n" +
      "Options:\n" +
      "  --interval <seconds>   Polling interval in seconds (default: 60)\n" +
      "  -h, --help             Show this help message\n" +
      "\n" +
      "Environment:\n" +
      "  POST_DAYS           Comma-separated day abbreviations (default: MON,WED,FRI)\n" +
      "  POST_TIME           Publish time in HH:MM format (default: 10:00)\n" +
      "  POST_TIMEZONE       IANA timezone name (default: Asia/Kolkata)\n" +
      "  LINKEDCTL_DB_PATH   Path to SQLite database (default: ./linkedin-automation.db)\n" +
      "  LINKEDCTL_PROFILE   LinkedIn profile name from linkedctl config\n" +
      "\n" +
      "Examples:\n" +
      "  linkedin-auto run-worker\n" +
      "  linkedin-auto run-worker --interval 30\n" +
      "  linkedin-auto run-worker --interval 300\n" +
      "\n" +
      "The worker will:\n" +
      "  1. Poll for due scheduled posts every N seconds\n" +
      "  2. Publish them via LinkedIn\n" +
      "  3. Retry on transient failures with exponential backoff\n" +
      "  4. Stop gracefully on SIGINT or SIGTERM",
  );
}

/**
 * Run the worker command.
 */
async function runWorker(argv: string[]): Promise<void> {
  const args = parseWorkerArgs(argv);

  if (args.help) {
    printWorkerUsage();
    return;
  }

  const { SqliteStorage: SqliteStorageClass } = await import("./storage/sqlite-storage.js");
  const { IdempotentPublisher: IdempotentPublisherClass } = await import("./storage/idempotent-publisher.js");
  const { LinkedCtlPublisher: LinkedCtlPublisherClass } = await import("./linkedin/linkedctl-publisher.js");
  const { Scheduler: SchedulerClass } = await import("./scheduler/scheduler.js");
  const { loadScheduleConfig } = await import("./scheduler/schedule.js");

  const dbPath = process.env["LINKEDCTL_DB_PATH"] ?? "./linkedin-automation.db";
  const profile = process.env["LINKEDCTL_PROFILE"];

  const storage = new SqliteStorageClass(dbPath);
  storage.initialize();

  const publisher = new LinkedCtlPublisherClass(profile);
  const idempotent = new IdempotentPublisherClass(storage, publisher);
  const scheduleConfig = loadScheduleConfig();

  const scheduler = new SchedulerClass(storage, idempotent, {
    pollIntervalMs: args.interval * 1000,
    onPublish: (result) => {
      if (result.success) {
        if (result.alreadyPublished) {
          console.error(
            `[${new Date().toISOString()}] Skipped (already published): draft #${result.scheduledPost.draftId}`,
          );
        } else {
          console.error(
            `[${new Date().toISOString()}] Published: draft #${result.scheduledPost.draftId} (attempt ${result.attempts})`,
          );
        }
      } else {
        console.error(
          `[${new Date().toISOString()}] Failed: draft #${result.scheduledPost.draftId} — ${result.error} (${result.failureCategory})`,
        );
      }
    },
  });

  // Graceful shutdown
  const shutdown = (): void => {
    console.error("\nShutting down worker...");
    scheduler.stop();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.error(`[${new Date().toISOString()}] Starting publish worker (poll every ${args.interval}s)...`);
  console.error(
    `[${new Date().toISOString()}] Schedule: ${scheduleConfig.postDays.join(", ")} at ${scheduleConfig.postTime} ${scheduleConfig.postTimezone}`,
  );
  console.error(`[${new Date().toISOString()}] Press Ctrl+C to stop.\n`);

  try {
    await scheduler.start();
  } finally {
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);
    storage.close();
  }

  const stats = scheduler.getStats();
  console.error(`\n[${new Date().toISOString()}] Worker stopped.`);
  console.error(`  Poll cycles: ${stats.pollCycles}`);
  console.error(`  Posts attempted: ${stats.postsAttempted}`);
  console.error(`  Posts published: ${stats.postsPublished}`);
  console.error(`  Posts failed: ${stats.postsFailed}`);
}

// ─── Draft Management Commands ──────────────────────────────

/**
 * Parse list command arguments.
 */
function parseListArgs(argv: string[]): {
  state: string | undefined;
  help: boolean;
} {
  let state: string | undefined;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    switch (arg) {
      case "--state":
        state = argv[++i];
        break;
      case "--help":
      case "-h":
        help = true;
        break;
    }
  }

  return { state, help };
}

function printListUsage(): void {
  console.log(
    "linkedin-auto list — List all drafts\n" +
      "\n" +
      "Usage:\n" +
      "  linkedin-auto list [options]\n" +
      "\n" +
      "Options:\n" +
      "  --state <STATE>   Filter by state (REVIEW_REQUIRED, APPROVED, etc.)\n" +
      "  -h, --help        Show this help message\n" +
      "\n" +
      "States:\n" +
      "  DISCOVERED, ANALYZING, DRAFT, REVIEW_REQUIRED, APPROVED,\n" +
      "  SCHEDULED, PROCESSING, PUBLISHED, FAILED, SKIPPED\n" +
      "\n" +
      "Environment:\n" +
      "  LINKEDCTL_DB_PATH   Path to SQLite database (default: ./linkedin-automation.db)\n" +
      "\n" +
      "Examples:\n" +
      "  linkedin-auto list\n" +
      "  linkedin-auto list --state REVIEW_REQUIRED\n" +
      "  linkedin-auto list --state APPROVED",
  );
}

/**
 * Run the list command.
 */
async function runList(argv: string[]): Promise<void> {
  const args = parseListArgs(argv);

  if (args.help) {
    printListUsage();
    return;
  }

  const { SqliteStorage: SqliteStorageClass } = await import("./storage/sqlite-storage.js");
  const { listDrafts } = await import("./draft-management/draft-manager.js");

  const dbPath = process.env["LINKEDCTL_DB_PATH"] ?? "./linkedin-automation.db";
  const storage = new SqliteStorageClass(dbPath);
  storage.initialize();

  try {
    const stateFilter = args.state as import("./storage/types.js").PostState | undefined;
    const drafts = listDrafts(storage, stateFilter);

    if (drafts.length === 0) {
      console.log("No drafts found.");
      if (args.state !== undefined) {
        console.log("Try without --state filter to see all drafts.");
      }
      return;
    }

    console.log("═══════════════════════════════════════════");
    console.log("  DRAFTS" + (args.state !== undefined ? " (" + args.state + ")" : ""));
    console.log("═══════════════════════════════════════════");
    console.log("");

    for (const draft of drafts) {
      const stateIcon =
        draft.state === "REVIEW_REQUIRED"
          ? "⏳"
          : draft.state === "APPROVED"
            ? "✅"
            : draft.state === "PUBLISHED"
              ? "📤"
              : draft.state === "SKIPPED"
                ? "⏭️"
                : "📝";
      console.log(`  ${stateIcon} #${draft.id} | ${draft.state} | Score: ${draft.reviewScore}/100`);
      console.log(`     ${draft.preview}`);
      console.log(`     Words: ${draft.wordCount} | Created: ${draft.createdAt.slice(0, 10)}`);
      console.log("");
    }

    console.log("═══════════════════════════════════════════");
    console.log(`  Total: ${drafts.length} draft(s)`);
    console.log("═══════════════════════════════════════════");
  } finally {
    storage.close();
  }
}

/**
 * Parse view command arguments.
 */
function parseViewArgs(argv: string[]): {
  draftId: number | undefined;
  help: boolean;
} {
  let draftId: number | undefined;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    switch (arg) {
      case "--help":
      case "-h":
        help = true;
        break;
      default:
        if (draftId === undefined && !arg.startsWith("--")) {
          draftId = Number.parseInt(arg, 10);
        }
        break;
    }
  }

  return { draftId, help };
}

function printViewUsage(): void {
  console.log(
    "linkedin-auto view — View draft details\n" +
      "\n" +
      "Usage:\n" +
      "  linkedin-auto view <draft-id>\n" +
      "\n" +
      "Options:\n" +
      "  -h, --help    Show this help message\n" +
      "\n" +
      "Environment:\n" +
      "  LINKEDCTL_DB_PATH   Path to SQLite database (default: ./linkedin-automation.db)\n" +
      "\n" +
      "Examples:\n" +
      "  linkedin-auto view 42",
  );
}

/**
 * Run the view command.
 */
async function runView(argv: string[]): Promise<void> {
  const args = parseViewArgs(argv);

  if (args.help) {
    printViewUsage();
    return;
  }

  if (args.draftId === undefined || Number.isNaN(args.draftId)) {
    console.error("Error: Draft ID is required.");
    console.error("Run with --help for usage information.");
    process.exit(2);
  }

  const { SqliteStorage: SqliteStorageClass } = await import("./storage/sqlite-storage.js");
  const { viewDraft } = await import("./draft-management/draft-manager.js");

  const dbPath = process.env["LINKEDCTL_DB_PATH"] ?? "./linkedin-automation.db";
  const storage = new SqliteStorageClass(dbPath);
  storage.initialize();

  try {
    const details = viewDraft(storage, args.draftId);

    if (details === undefined) {
      console.error(`Error: Draft #${args.draftId} not found.`);
      process.exit(1);
    }

    const { draft, candidateTitle, candidateRepo } = details;

    console.log("═══════════════════════════════════════════");
    console.log(`  DRAFT #${draft.id}`);
    console.log("═══════════════════════════════════════════");
    console.log("");
    console.log("  State:       " + draft.state);
    console.log("  Candidate:   " + (candidateTitle ?? "(unknown)"));
    console.log("  Repository:  " + (candidateRepo ?? "(unknown)"));
    console.log(`  Words:       ${draft.wordCount}`);
    console.log(`  Review:      ${draft.reviewDecision} (${draft.reviewScore}/100)`);
    console.log(`  Slop Score:  ${draft.slopScore}/100`);
    console.log("  Created:     " + draft.createdAt);
    console.log("");

    console.log("  ─── Draft Text ──────────────────────────");
    console.log("");
    console.log(draft.text);
    console.log("");

    if (draft.suggestions.length > 0) {
      console.log("  ─── Suggestions ─────────────────────────");
      console.log("");
      for (const s of draft.suggestions) {
        console.log("    • " + s);
      }
      console.log("");
    }

    console.log("═══════════════════════════════════════════");
  } finally {
    storage.close();
  }
}

/**
 * Parse approve command arguments.
 */
function parseApproveArgs(argv: string[]): {
  draftId: number | undefined;
  help: boolean;
} {
  let draftId: number | undefined;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    switch (arg) {
      case "--help":
      case "-h":
        help = true;
        break;
      default:
        if (draftId === undefined && !arg.startsWith("--")) {
          draftId = Number.parseInt(arg, 10);
        }
        break;
    }
  }

  return { draftId, help };
}

function printApproveUsage(): void {
  console.log(
    "linkedin-auto approve — Approve a draft for publishing\n" +
      "\n" +
      "Usage:\n" +
      "  linkedin-auto approve <draft-id>\n" +
      "\n" +
      "Options:\n" +
      "  -h, --help    Show this help message\n" +
      "\n" +
      "Environment:\n" +
      "  LINKEDCTL_DB_PATH   Path to SQLite database (default: ./linkedin-automation.db)\n" +
      "\n" +
      "Examples:\n" +
      "  linkedin-auto approve 42",
  );
}

/**
 * Run the approve command.
 */
async function runApprove(argv: string[]): Promise<void> {
  const args = parseApproveArgs(argv);

  if (args.help) {
    printApproveUsage();
    return;
  }

  if (args.draftId === undefined || Number.isNaN(args.draftId)) {
    console.error("Error: Draft ID is required.");
    console.error("Run with --help for usage information.");
    process.exit(2);
  }

  const { SqliteStorage: SqliteStorageClass } = await import("./storage/sqlite-storage.js");
  const { approveDraft } = await import("./draft-management/draft-manager.js");

  const dbPath = process.env["LINKEDCTL_DB_PATH"] ?? "./linkedin-automation.db";
  const storage = new SqliteStorageClass(dbPath);
  storage.initialize();

  try {
    const result = approveDraft(storage, args.draftId);

    if (result.success) {
      console.log("✅ " + result.message);
    } else {
      console.error("❌ " + result.message);
      process.exit(1);
    }
  } finally {
    storage.close();
  }
}

/**
 * Parse edit command arguments.
 */
function parseEditArgs(argv: string[]): {
  draftId: number | undefined;
  text: string | undefined;
  help: boolean;
} {
  let draftId: number | undefined;
  let text: string | undefined;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    switch (arg) {
      case "--text":
        text = argv[++i];
        break;
      case "--help":
      case "-h":
        help = true;
        break;
      default:
        if (draftId === undefined && !arg.startsWith("--")) {
          draftId = Number.parseInt(arg, 10);
        } else if (text === undefined && !arg.startsWith("--")) {
          text = arg;
        }
        break;
    }
  }

  return { draftId, text, help };
}

function printEditUsage(): void {
  console.log(
    "linkedin-auto edit — Edit draft text\n" +
      "\n" +
      "Usage:\n" +
      '  linkedin-auto edit <draft-id> --text "new text"\n' +
      '  linkedin-auto edit <draft-id> "new text"\n' +
      "\n" +
      "Options:\n" +
      "  --text <text>    New text content (or pass as positional argument)\n" +
      "  -h, --help       Show this help message\n" +
      "\n" +
      "Environment:\n" +
      "  LINKEDCTL_DB_PATH   Path to SQLite database (default: ./linkedin-automation.db)\n" +
      "\n" +
      "Examples:\n" +
      '  linkedin-auto edit 42 --text "Updated post content here"\n' +
      '  linkedin-auto edit 42 "Updated post content here"',
  );
}

/**
 * Run the edit command.
 */
async function runEdit(argv: string[]): Promise<void> {
  const args = parseEditArgs(argv);

  if (args.help) {
    printEditUsage();
    return;
  }

  if (args.draftId === undefined || Number.isNaN(args.draftId)) {
    console.error("Error: Draft ID is required.");
    console.error("Run with --help for usage information.");
    process.exit(2);
  }

  if (args.text === undefined || args.text.trim() === "") {
    console.error('Error: New text is required. Use --text "your text" or pass as argument.');
    console.error("Run with --help for usage information.");
    process.exit(2);
  }

  const { SqliteStorage: SqliteStorageClass } = await import("./storage/sqlite-storage.js");
  const { editDraft } = await import("./draft-management/draft-manager.js");

  const dbPath = process.env["LINKEDCTL_DB_PATH"] ?? "./linkedin-automation.db";
  const storage = new SqliteStorageClass(dbPath);
  storage.initialize();

  try {
    const result = editDraft(storage, args.draftId, args.text);

    if (result.success) {
      console.log("✅ " + result.message);
    } else {
      console.error("❌ " + result.message);
      process.exit(1);
    }
  } finally {
    storage.close();
  }
}

/**
 * Parse reject command arguments.
 */
function parseRejectArgs(argv: string[]): {
  draftId: number | undefined;
  help: boolean;
} {
  let draftId: number | undefined;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    switch (arg) {
      case "--help":
      case "-h":
        help = true;
        break;
      default:
        if (draftId === undefined && !arg.startsWith("--")) {
          draftId = Number.parseInt(arg, 10);
        }
        break;
    }
  }

  return { draftId, help };
}

function printRejectUsage(): void {
  console.log(
    "linkedin-auto reject — Reject/skip a draft\n" +
      "\n" +
      "Usage:\n" +
      "  linkedin-auto reject <draft-id>\n" +
      "  linkedin-auto skip <draft-id>\n" +
      "\n" +
      "Options:\n" +
      "  -h, --help    Show this help message\n" +
      "\n" +
      "Environment:\n" +
      "  LINKEDCTL_DB_PATH   Path to SQLite database (default: ./linkedin-automation.db)\n" +
      "\n" +
      "Examples:\n" +
      "  linkedin-auto reject 42\n" +
      "  linkedin-auto skip 42",
  );
}

/**
 * Run the reject command.
 */
async function runReject(argv: string[]): Promise<void> {
  const args = parseRejectArgs(argv);

  if (args.help) {
    printRejectUsage();
    return;
  }

  if (args.draftId === undefined || Number.isNaN(args.draftId)) {
    console.error("Error: Draft ID is required.");
    console.error("Run with --help for usage information.");
    process.exit(2);
  }

  const { SqliteStorage: SqliteStorageClass } = await import("./storage/sqlite-storage.js");
  const { rejectDraft } = await import("./draft-management/draft-manager.js");

  const dbPath = process.env["LINKEDCTL_DB_PATH"] ?? "./linkedin-automation.db";
  const storage = new SqliteStorageClass(dbPath);
  storage.initialize();

  try {
    const result = rejectDraft(storage, args.draftId);

    if (result.success) {
      console.log("✅ " + result.message);
    } else {
      console.error("❌ " + result.message);
      process.exit(1);
    }
  } finally {
    storage.close();
  }
}

/**
 * Parse post-now command arguments.
 */
function parsePostNowArgs(argv: string[]): {
  draftId: number | undefined;
  help: boolean;
} {
  let draftId: number | undefined;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    switch (arg) {
      case "--help":
      case "-h":
        help = true;
        break;
      default:
        if (draftId === undefined && !arg.startsWith("--")) {
          draftId = Number.parseInt(arg, 10);
        }
        break;
    }
  }

  return { draftId, help };
}

function printPostNowUsage(): void {
  console.log(
    "linkedin-auto post-now — Publish a draft immediately\n" +
      "\n" +
      "Usage:\n" +
      "  linkedin-auto post-now <draft-id>\n" +
      "\n" +
      "Options:\n" +
      "  -h, --help    Show this help message\n" +
      "\n" +
      "Environment:\n" +
      "  LINKEDCTL_DB_PATH   Path to SQLite database (default: ./linkedin-automation.db)\n" +
      "\n" +
      "Examples:\n" +
      "  linkedin-auto post-now 42",
  );
}

/**
 * Run the post-now command.
 */
async function runPostNow(argv: string[]): Promise<void> {
  const args = parsePostNowArgs(argv);

  if (args.help) {
    printPostNowUsage();
    return;
  }

  if (args.draftId === undefined || Number.isNaN(args.draftId)) {
    console.error("Error: Draft ID is required.");
    console.error("Run with --help for usage information.");
    process.exit(2);
  }

  const { SqliteStorage: SqliteStorageClass } = await import("./storage/sqlite-storage.js");
  const { postNow } = await import("./draft-management/draft-manager.js");

  const dbPath = process.env["LINKEDCTL_DB_PATH"] ?? "./linkedin-automation.db";
  const storage = new SqliteStorageClass(dbPath);
  storage.initialize();

  try {
    const result = postNow(storage, args.draftId);

    if (result.success) {
      console.log("📤 " + result.message);
      console.log("");
      console.log("The draft has been queued for immediate publishing.");
      console.log("Run 'linkedin-auto run-worker' to process the queue.");
    } else {
      console.error("❌ " + result.message);
      process.exit(1);
    }
  } finally {
    storage.close();
  }
}

// ─── Flow Status Command ────────────────────────────────────

/**
 * Parse flow-status command arguments.
 */
function parseFlowStatusArgs(argv: string[]): {
  help: boolean;
} {
  let help = false;

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      help = true;
    }
  }

  return { help };
}

function printFlowStatusUsage(): void {
  console.log(
    "linkedin-auto flow-status \u2014 Check Flow Agent connection\n" +
      "\n" +
      "Usage:\n" +
      "  linkedin-auto flow-status [options]\n" +
      "\n" +
      "Options:\n" +
      "  -h, --help    Show this help message\n" +
      "\n" +
      "Environment:\n" +
      "  FLOW_AGENT_URL   Flow Agent backend URL (default: http://127.0.0.1:8001)\n" +
      "\n" +
      "This command checks:\n" +
      "  1. Whether the Flow Agent Python backend is running\n" +
      "  2. Whether the Chrome extension is connected\n" +
      "  3. Whether a Google Flow session key is available\n" +
      "\n" +
      "If the backend is not running, it will attempt to start it automatically.\n" +
      "\n" +
      "Examples:\n" +
      "  linkedin-auto flow-status",
  );
}

/**
 * Run the flow-status command.
 */
async function runFlowStatus(argv: string[]): Promise<void> {
  const args = parseFlowStatusArgs(argv);

  if (args.help) {
    printFlowStatusUsage();
    return;
  }

  const { loadConfig } = await import("./config/config.js");
  const { FlowAgentClient } = await import("./flow/flow-agent-client.js");

  const config = loadConfig();
  const client = new FlowAgentClient(config);

  console.error(`Checking Flow Agent at ${config.flowAgentUrl}...\n`);

  // Try to ensure the backend is running
  const backendRunning = await client.ensureBackendRunning();

  if (!backendRunning) {
    console.error("\n❌ Flow Agent backend is not running.");
    console.error("\nTo fix this:");
    console.error("  1. Install Python dependencies: cd flow-agent && pip install -e .");
    console.error("  2. Start the backend: flow (or python flow-agent/main.py)");
    console.error("  3. Open Google Flow in Chrome: https://labs.google/fx/tools/flow");
    console.error("  4. Enable the Flow Agent Chrome extension");
    console.error("  5. Refresh the Google Flow tab");
    process.exit(1);
  }

  // Get detailed health status
  let health;
  try {
    health = await client.health();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`\n❌ Health check failed: ${message}`);
    process.exit(1);
  }

  console.log("═══════════════════════════════════════════");
  console.log("  FLOW AGENT STATUS");
  console.log("═══════════════════════════════════════════");
  console.log("");
  console.log(`  Backend URL:      ${config.flowAgentUrl}`);
  console.log(`  Status:           ${health.status}`);
  console.log(`  Extension:        ${health.extensionConnected ? "✅ Connected" : "❌ Disconnected"}`);
  console.log(`  Flow Key:         ${health.hasFlowKey ? "✅ Available" : "❌ Missing"}`);
  console.log("");

  if (health.extensionConnected && health.hasFlowKey) {
    console.log("  ✅ Flow Agent is ready for image generation!");
    console.log("");
    console.log("  You can now use:");
    console.log('    linkedin-auto manual --text "Your post" --generate-visual');
  } else {
    console.log("  ⚠️  Flow Agent is not ready for image generation.");
    console.log("");
    if (!health.extensionConnected) {
      console.log("  To fix extension connection:");
      console.log("    1. Open Google Flow in Chrome: https://labs.google/fx/tools/flow");
      console.log("    2. Click the Flow Agent extension icon in Chrome toolbar");
      console.log("    3. Ensure the extension shows 'Connected'");
    }
    if (!health.hasFlowKey) {
      console.log("  To fix Flow key:");
      console.log("    1. Open Google Flow in Chrome: https://labs.google/fx/tools/flow");
      console.log("    2. Sign in with your Google account");
      console.log("    3. The Flow Agent extension will capture the session key");
    }
  }

  console.log("═══════════════════════════════════════════");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
