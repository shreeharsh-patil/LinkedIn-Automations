// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

// Failure classification
export { classifyFailure } from "./failure-classifier.js";
export type { FailureCategory, ClassifiedFailure } from "./failure-classifier.js";

// Retry logic
export { calculateRetry, sleep, DEFAULT_RETRY_CONFIG } from "./retry.js";
export type { RetryConfig, RetryDecision } from "./retry.js";

// Schedule configuration
export {
  loadScheduleConfig,
  parsePostDays,
  validatePostTime,
  validateTimezone,
  dayOfWeekToJsDay,
  nowInTimezone,
  isScheduledDay,
  calculateNextPublishTime,
  isInPublishWindow,
} from "./schedule.js";
export type { DayOfWeek, ScheduleConfig } from "./schedule.js";

// Scheduler
export { Scheduler } from "./scheduler.js";
export type { SchedulerOptions, PublishAttemptResult, WorkerStats } from "./scheduler.js";
