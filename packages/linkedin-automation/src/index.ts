// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

// Types
export type {
  AccountInfo,
  PublishResult,
  PublishTextOptions,
  PublishImageOptions,
  GenerateImageOptions,
  GeneratedImage,
  FlowHealthStatus,
} from "./types/index.js";

// Configuration
export { loadConfig, ConfigurationError } from "./config/config.js";
export type { AutomationConfig } from "./config/config.js";

// LinkedIn adapter
export { LinkedCtlPublisher, LinkedInAdapterError } from "./linkedin/linkedctl-publisher.js";
export type { AuthPreflightReport } from "./linkedin/linkedctl-publisher.js";

// Errors
export {
  AutomationError,
  AuthError,
  PermissionError,
  ValidationError,
  RateLimitError,
  MediaError,
  LinkedInApiError,
  QueueError,
  DatabaseError,
  redactSecrets,
} from "./errors/index.js";
export type { ErrorCategory } from "./errors/index.js";

// Validation & Quality Guard
export { ContentValidator } from "./agents/content-validator.js";
export type { ValidationMetrics, ContentValidationReport } from "./agents/content-validator.js";

// Manual post workflow
export {
  createManualPost,
  validateManualPost,
  publishManualPost,
  formatPreview,
  ManualPostError,
} from "./linkedin/manual-post.js";
export type { ManualPostOptions, ManualPostPreview } from "./linkedin/manual-post.js";

// Prepare pipeline
export { runPreparePipeline } from "./pipeline/prepare-pipeline.js";
export type { PreparedDraft, DraftStatus, PrepareOptions } from "./pipeline/prepare-pipeline.js";
export {
  createDeduplicationStore,
  isDuplicateCandidate,
  markAsSeen,
  filterDuplicates,
  isDuplicateDraft,
  markDraftAsSeen,
} from "./pipeline/deduplication.js";
export type { DeduplicationStore } from "./pipeline/deduplication.js";

// Content generation pipeline
export { extractFacts } from "./agents/fact-extractor.js";
export type { Fact, FactExtractionResult } from "./agents/fact-extractor.js";
export { writeDraft } from "./agents/writer.js";
export type { DraftResult, WriteOptions } from "./agents/writer.js";
export { detectSlop } from "./agents/slop-guard.js";
export type { SlopViolation, SlopGuardResult, SlopSeverity } from "./agents/slop-guard.js";
export { verifyClaims } from "./agents/claim-verifier.js";
export type { ClaimStatus, VerifiedClaim, ClaimVerificationResult } from "./agents/claim-verifier.js";
export { reviewDraft } from "./agents/reviewer.js";
export type { ReviewDecision, ReviewResult } from "./agents/reviewer.js";
export { runPipeline } from "./agents/pipeline.js";
export type { PipelineResult } from "./agents/pipeline.js";

// GitHub sources
export { GitHubClient } from "./sources/github/github-client.js";
export type {
  GitHubCommit,
  GitHubFile,
  GitHubRelease,
  GitHubPullRequest,
  GitHubIssue,
  GitHubRepo,
} from "./sources/github/github-client.js";
export { analyzeCommit } from "./sources/github/commit-analyzer.js";
export type { CommitType, CommitAnalysis } from "./sources/github/commit-analyzer.js";
export { groupCommits } from "./sources/github/change-grouper.js";
export type { CommitGroup } from "./sources/github/change-grouper.js";
export { scoreActivity, scoreRelease, DEFAULT_POST_SCORE_THRESHOLD } from "./sources/github/activity-scorer.js";
export type { ScoredActivity } from "./sources/github/activity-scorer.js";
export { analyzeRepository } from "./sources/github/repository-analyzer.js";
export type { ContentCandidate, AnalysisOptions } from "./sources/github/repository-analyzer.js";

// Storage
export {
  POST_STATES,
  VALID_TRANSITIONS,
  isValidTransition,
  DEFAULT_SETTINGS,
  SqliteStorage,
  normalizeContent,
  generateContentHash,
  generateCandidateHash,
  hashDistance,
  IdempotentPublisher,
} from "./storage/index.js";
export type {
  PostState,
  ContentCandidateRecord,
  PostDraftRecord,
  ScheduledPostRecord,
  PublishedPostRecord,
  AutomationSettingsRecord,
  StoragePort,
  IdempotentPublishResult,
} from "./storage/index.js";

// Scheduler
export {
  classifyFailure,
  calculateRetry,
  sleep,
  DEFAULT_RETRY_CONFIG,
  loadScheduleConfig,
  parsePostDays,
  validatePostTime,
  validateTimezone,
  dayOfWeekToJsDay,
  nowInTimezone,
  isScheduledDay,
  calculateNextPublishTime,
  isInPublishWindow,
  Scheduler,
} from "./scheduler/index.js";
export type {
  FailureCategory,
  ClassifiedFailure,
  RetryConfig,
  RetryDecision,
  DayOfWeek,
  ScheduleConfig,
  SchedulerOptions,
  PublishAttemptResult,
  WorkerStats,
} from "./scheduler/index.js";

// Automation mode
export {
  loadAutomationMode,
  parseAutomationMode,
  allowsAutoPublish,
  shouldStopAtReview,
  AUTOMATION_MODES,
  DEFAULT_AUTOMATION_MODE,
} from "./config/automation-mode.js";
export type { AutomationMode } from "./config/automation-mode.js";

// Safety checker
export { checkSafety, DEFAULT_SAFETY_CONFIG } from "./config/safety-checker.js";
export type { SafetyCheckResult, SafetyFailure, SafetyCheck, SafetyCheckConfig } from "./config/safety-checker.js";

// Draft management
export {
  listDrafts,
  viewDraft,
  approveDraft,
  editDraft,
  rejectDraft,
  postNow,
} from "./draft-management/draft-manager.js";
export type { DraftListItem, DraftViewDetails, DraftActionResult } from "./draft-management/draft-manager.js";

// Flow Agent client
export { FlowAgentClient, FlowAgentError } from "./flow/flow-agent-client.js";
// Note: FlowAgentClient.ensureBackendRunning() is available for auto-starting the backend

// Visual generation
export { createVisualDirector } from "./flow/visual-director.js";
export type { VisualType, VisualDecision, PostContext } from "./flow/visual-director.js";
export { generateVisual } from "./flow/generated-visual.js";
export type { GeneratedVisualResult } from "./flow/generated-visual.js";
