// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Schedule configuration for automated posting.
 *
 * Reads from environment variables:
 * - POST_DAYS: Comma-separated day abbreviations (MON,TUE,WED,THU,FRI,SAT,SUN)
 * - POST_TIME: HH:MM format in 24-hour time
 * - POST_TIMEZONE: IANA timezone name (e.g. Asia/Kolkata, America/New_York)
 *
 * Default: MON,WED,FRI at 10:00 Asia/Kolkata
 */

/**
 * Valid day abbreviations.
 */
export type DayOfWeek = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";

/**
 * Valid day abbreviations set.
 */

/**
 * Schedule configuration.
 */
export interface ScheduleConfig {
  /** Days of the week to post (0=Sunday ... 6=Saturday in JS Date). */
  postDays: DayOfWeek[];
  /** Time of day to post (HH:MM). */
  postTime: string;
  /** IANA timezone name. */
  postTimezone: string;
}

/**
 * Parse a comma-separated list of day abbreviations.
 *
 * Accepts both full and abbreviated day names (case-insensitive).
 * Returns a sorted array of normalized uppercase abbreviations.
 */
export function parsePostDays(value: string): DayOfWeek[] {
  const days = value
    .split(",")
    .map((d) => d.trim().toUpperCase())
    .map((d) => normalizeDay(d))
    .filter((d): d is DayOfWeek => d !== undefined);

  // Deduplicate and sort by day order
  const unique = [...new Set(days)];
  unique.sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
  return unique;
}

/**
 * Normalize a day name to our standard abbreviations.
 */
function normalizeDay(name: string): DayOfWeek | undefined {
  const map: Record<string, DayOfWeek> = {
    MON: "MON",
    MONDAY: "MON",
    TUE: "TUE",
    TUESDAY: "TUE",
    WED: "WED",
    WEDNESDAY: "WED",
    THU: "THU",
    THURSDAY: "THU",
    FRI: "FRI",
    FRIDAY: "FRI",
    SAT: "SAT",
    SATURDAY: "SAT",
    SUN: "SUN",
    SUNDAY: "SUN",
  };
  return map[name];
}

/**
 * Day order for sorting.
 */
const DAY_ORDER: readonly DayOfWeek[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

/**
 * Validate a time string in HH:MM format.
 *
 * @throws Error if the time is invalid.
 */
export function validatePostTime(value: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (match === null) {
    throw new Error(`Invalid POST_TIME format "${value}". Expected HH:MM (e.g. "10:00")`);
  }
  const hours = Number.parseInt(match[1] ?? "0", 10);
  const minutes = Number.parseInt(match[2] ?? "0", 10);
  if (hours > 23 || minutes > 59) {
    throw new Error(`Invalid POST_TIME "${value}". Hours must be 0-23, minutes must be 0-59`);
  }
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Validate a timezone string by attempting to create a formatter.
 *
 * @throws Error if the timezone is invalid.
 */
export function validateTimezone(value: string): string {
  try {
    // Test if the timezone is valid by creating a formatter
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    throw new Error(
      `Invalid POST_TIMEZONE "${value}". Use an IANA timezone name (e.g. "Asia/Kolkata", "America/New_York")`,
    );
  }
}

/**
 * Load schedule configuration from environment variables.
 *
 * @param env - Environment object (defaults to process.env).
 * @returns Parsed and validated schedule configuration.
 * @throws Error if any value is invalid.
 */
export function loadScheduleConfig(env?: Record<string, string | undefined>): ScheduleConfig {
  const environment = env ?? process.env;

  const daysRaw = environment["POST_DAYS"] ?? "MON,WED,FRI";
  const timeRaw = environment["POST_TIME"] ?? "10:00";
  const timezoneRaw = environment["POST_TIMEZONE"] ?? "Asia/Kolkata";

  const postDays = parsePostDays(daysRaw);
  if (postDays.length === 0) {
    throw new Error(`No valid days found in POST_DAYS "${daysRaw}". Use abbreviations: MON,TUE,WED,THU,FRI,SAT,SUN`);
  }

  const postTime = validatePostTime(timeRaw);
  const postTimezone = validateTimezone(timezoneRaw);

  return { postDays, postTime, postTimezone };
}

/**
 * Convert a DayOfWeek to a JS Date day number (0=Sunday).
 */
export function dayOfWeekToJsDay(day: DayOfWeek): number {
  const map: Record<DayOfWeek, number> = {
    SUN: 0,
    MON: 1,
    TUE: 2,
    WED: 3,
    THU: 4,
    FRI: 5,
    SAT: 6,
  };
  return map[day];
}

/**
 * Get the current time in the specified timezone as a Date object.
 *
 * Returns a Date whose UTC values represent the wall-clock time
 * in the target timezone.
 */
export function nowInTimezone(timezone: string, date: Date = new Date()): Date {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";

  // Create a Date in UTC from the timezone wall-clock values
  return new Date(
    Date.UTC(
      Number(get("year")),
      Number(get("month")) - 1,
      Number(get("day")),
      Number(get("hour")),
      Number(get("minute")),
      Number(get("second")),
    ),
  );
}

/**
 * Check if a given day (JS Date day number) is in the schedule.
 */
export function isScheduledDay(dayJs: number, postDays: DayOfWeek[]): boolean {
  return postDays.some((d) => dayOfWeekToJsDay(d) === dayJs);
}

/**
 * Convert a wall-clock time expressed as a pseudo-UTC Date (whose UTC
 * fields mirror the wall clock in `timezone`) into the real UTC instant.
 *
 * The UTC offset at that wall-clock instant is measured by comparing the
 * reference's pseudo wall clock against its real epoch; a couple of
 * iterations converge even across DST transitions.
 */
function wallClockToRealUtc(timezone: string, wallClock: Date): Date {
  let instant = wallClock.getTime();
  for (let i = 0; i < 4; i++) {
    const realNow = new Date(instant);
    const offsetMs = nowInTimezone(timezone, realNow).getTime() - realNow.getTime();
    const next = wallClock.getTime() - offsetMs;
    if (next === instant) break;
    instant = next;
  }
  return new Date(instant);
}

/**
 * Calculate the next scheduled publish time.
 *
 * Returns a Date representing the next wall-clock slot (in the configured
 * timezone) expressed as the real UTC instant. Consumers should persist
 * `toISOString()` directly — it is comparable against real UTC timestamps.
 *
 * @param config - Schedule configuration.
 * @param from - Starting time (defaults to now).
 * @returns Date representing the next publish slot.
 */
export function calculateNextPublishTime(config: ScheduleConfig, from?: Date): Date {
  const nowInTz = nowInTimezone(config.postTimezone, from);

  // Parse the target time
  const [hours, minutes] = config.postTime.split(":").map(Number);

  // Create a candidate wall-clock date for today at the target time
  const candidate = new Date(nowInTz);
  candidate.setUTCHours(hours ?? 10, minutes ?? 0, 0, 0);

  // If candidate is in the past or it's not a scheduled day, move forward
  if (candidate <= nowInTz || !isScheduledDay(candidate.getUTCDay(), config.postDays)) {
    // Find the next scheduled day
    for (let daysAhead = 1; daysAhead <= 7; daysAhead++) {
      const nextDay = new Date(nowInTz);
      nextDay.setUTCDate(nextDay.getUTCDate() + daysAhead);
      nextDay.setUTCHours(hours ?? 10, minutes ?? 0, 0, 0);

      if (isScheduledDay(nextDay.getUTCDay(), config.postDays)) {
        return wallClockToRealUtc(config.postTimezone, nextDay);
      }
    }
  }

  return wallClockToRealUtc(config.postTimezone, candidate);
}

/**
 * Check if the current time is within the publish window.
 *
 * A publish window is defined as: current time >= scheduled time
 * and current time < scheduled time + windowMs.
 *
 * @param scheduledAt - The scheduled publish time.
 * @param windowMs - Window size in milliseconds (default: 60000 = 1 minute).
 * @returns Whether we're in the publish window.
 */
export function isInPublishWindow(scheduledAt: Date, windowMs = 60_000): boolean {
  const now = new Date();
  return now >= scheduledAt && now < new Date(scheduledAt.getTime() + windowMs);
}
