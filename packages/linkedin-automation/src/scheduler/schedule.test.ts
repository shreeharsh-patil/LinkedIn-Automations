// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";

import {
  parsePostDays,
  validatePostTime,
  validateTimezone,
  loadScheduleConfig,
  dayOfWeekToJsDay,
  nowInTimezone,
  isScheduledDay,
  calculateNextPublishTime,
  isInPublishWindow,
} from "./schedule.js";

describe("parsePostDays", () => {
  it("parses comma-separated day abbreviations", () => {
    expect(parsePostDays("MON,WED,FRI")).toEqual(["MON", "WED", "FRI"]);
  });

  it("handles case insensitivity", () => {
    expect(parsePostDays("mon,tue,wed")).toEqual(["MON", "TUE", "WED"]);
  });

  it("handles full day names", () => {
    expect(parsePostDays("Monday,Wednesday,Friday")).toEqual(["MON", "WED", "FRI"]);
  });

  it("deduplicates days", () => {
    expect(parsePostDays("MON,MON,MON")).toEqual(["MON"]);
  });

  it("sorts by day order", () => {
    expect(parsePostDays("FRI,MON,WED")).toEqual(["MON", "WED", "FRI"]);
  });

  it("returns empty array for invalid input", () => {
    expect(parsePostDays("")).toEqual([]);
    expect(parsePostDays("INVALID")).toEqual([]);
  });

  it("handles whitespace", () => {
    expect(parsePostDays(" MON , WED , FRI ")).toEqual(["MON", "WED", "FRI"]);
  });
});

describe("validatePostTime", () => {
  it("accepts valid time format", () => {
    expect(validatePostTime("10:00")).toBe("10:00");
    expect(validatePostTime("0:00")).toBe("00:00");
    expect(validatePostTime("23:59")).toBe("23:59");
    expect(validatePostTime("9:30")).toBe("09:30");
  });

  it("throws for invalid format", () => {
    expect(() => validatePostTime("10:00:00")).toThrow("Invalid POST_TIME format");
    expect(() => validatePostTime("10")).toThrow("Invalid POST_TIME format");
    expect(() => validatePostTime("abc")).toThrow("Invalid POST_TIME format");
  });

  it("throws for invalid time values", () => {
    expect(() => validatePostTime("24:00")).toThrow("Hours must be 0-23");
    expect(() => validatePostTime("10:60")).toThrow("minutes must be 0-59");
  });
});

describe("validateTimezone", () => {
  it("accepts valid timezones", () => {
    expect(validateTimezone("Asia/Kolkata")).toBe("Asia/Kolkata");
    expect(validateTimezone("America/New_York")).toBe("America/New_York");
    expect(validateTimezone("UTC")).toBe("UTC");
    expect(validateTimezone("Europe/London")).toBe("Europe/London");
  });

  it("throws for invalid timezones", () => {
    expect(() => validateTimezone("Invalid/Timezone")).toThrow("Invalid POST_TIMEZONE");
    expect(() => validateTimezone("NotATimezone")).toThrow("Invalid POST_TIMEZONE");
  });
});

describe("loadScheduleConfig", () => {
  it("returns defaults when no env vars set", () => {
    const config = loadScheduleConfig({});
    expect(config.postDays).toEqual(["MON", "WED", "FRI"]);
    expect(config.postTime).toBe("10:00");
    expect(config.postTimezone).toBe("Asia/Kolkata");
  });

  it("uses env vars when provided", () => {
    const config = loadScheduleConfig({
      POST_DAYS: "TUE,THU",
      POST_TIME: "14:30",
      POST_TIMEZONE: "America/New_York",
    });
    expect(config.postDays).toEqual(["TUE", "THU"]);
    expect(config.postTime).toBe("14:30");
    expect(config.postTimezone).toBe("America/New_York");
  });

  it("throws for invalid POST_DAYS", () => {
    expect(() => loadScheduleConfig({ POST_DAYS: "INVALID" })).toThrow("No valid days found");
  });

  it("throws for invalid POST_TIME", () => {
    expect(() => loadScheduleConfig({ POST_TIME: "abc" })).toThrow("Invalid POST_TIME format");
  });

  it("throws for invalid POST_TIMEZONE", () => {
    expect(() => loadScheduleConfig({ POST_TIMEZONE: "Invalid" })).toThrow("Invalid POST_TIMEZONE");
  });
});

describe("dayOfWeekToJsDay", () => {
  it("converts correctly", () => {
    expect(dayOfWeekToJsDay("SUN")).toBe(0);
    expect(dayOfWeekToJsDay("MON")).toBe(1);
    expect(dayOfWeekToJsDay("TUE")).toBe(2);
    expect(dayOfWeekToJsDay("WED")).toBe(3);
    expect(dayOfWeekToJsDay("THU")).toBe(4);
    expect(dayOfWeekToJsDay("FRI")).toBe(5);
    expect(dayOfWeekToJsDay("SAT")).toBe(6);
  });
});

describe("isScheduledDay", () => {
  it("returns true for matching days", () => {
    // Monday=1, Wednesday=3, Friday=5
    expect(isScheduledDay(1, ["MON", "WED", "FRI"])).toBe(true);
    expect(isScheduledDay(3, ["MON", "WED", "FRI"])).toBe(true);
    expect(isScheduledDay(5, ["MON", "WED", "FRI"])).toBe(true);
  });

  it("returns false for non-matching days", () => {
    expect(isScheduledDay(0, ["MON", "WED", "FRI"])).toBe(false);
    expect(isScheduledDay(2, ["MON", "WED", "FRI"])).toBe(false);
    expect(isScheduledDay(4, ["MON", "WED", "FRI"])).toBe(false);
    expect(isScheduledDay(6, ["MON", "WED", "FRI"])).toBe(false);
  });
});

describe("nowInTimezone", () => {
  it("returns a Date object", () => {
    const now = nowInTimezone("UTC");
    expect(now).toBeInstanceOf(Date);
  });

  it("returns approximate wall-clock time", () => {
    const now = nowInTimezone("UTC");
    const realNow = new Date();
    // Should be within a few seconds
    expect(Math.abs(now.getTime() - realNow.getTime())).toBeLessThan(5000);
  });
});

describe("calculateNextPublishTime", () => {
  it("returns a Date", () => {
    const config = {
      postDays: ["MON", "WED", "FRI"] as const,
      postTime: "10:00",
      postTimezone: "UTC",
    };
    const next = calculateNextPublishTime(config);
    expect(next).toBeInstanceOf(Date);
  });
});

describe("isInPublishWindow", () => {
  it("returns true when now is within window", () => {
    const scheduledAt = new Date(Date.now() - 30_000); // 30 seconds ago
    expect(isInPublishWindow(scheduledAt, 60_000)).toBe(true);
  });

  it("returns false when now is before scheduled time", () => {
    const scheduledAt = new Date(Date.now() + 60_000); // 1 minute from now
    expect(isInPublishWindow(scheduledAt, 60_000)).toBe(false);
  });

  it("returns false when now is after window", () => {
    const scheduledAt = new Date(Date.now() - 120_000); // 2 minutes ago
    expect(isInPublishWindow(scheduledAt, 60_000)).toBe(false);
  });
});
