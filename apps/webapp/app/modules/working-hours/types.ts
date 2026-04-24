import type { Prisma, WorkingHoursOverride } from "@prisma/client";

/**
 * Working-hours times are wall-clock "HH:MM" strings (24-hour). They describe
 * when a physical location is open, so they are always interpreted as local
 * wall-clock time — there is no timezone conversion at any point. Every time
 * field on the types below (`openTime`, `closeTime`, `start`, `end`, …)
 * follows this contract.
 */

// TypeScript types for JSON schedule
export interface DaySchedule {
  isOpen: boolean;
  openTime?: string;
  closeTime?: string;
}

export interface WeeklyScheduleJson {
  [dayOfWeek: string]: DaySchedule; // "0" through "6"
}

// Input specific type
export type WeeklyScheduleForUpdate = Prisma.InputJsonObject &
  WeeklyScheduleJson;

export enum DayOfWeek {
  SUNDAY = 0, // Sunday is 0, following ISO 8601 standard
  MONDAY = 1,
  TUESDAY = 2,
  WEDNESDAY = 3,
  THURSDAY = 4,
  FRIDAY = 5,
  SATURDAY = 6,
}
export interface TimeSlot {
  openTime: string | null; // wall-clock "HH:MM" — see docblock above DaySchedule.
  closeTime: string | null; // wall-clock "HH:MM" — see docblock above DaySchedule.
}

export interface WorkingHoursConfig {
  id: string;
  organizationId: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Override shape after passing through the normalize/serialize boundary
 * (`normalizeWorkingHoursForValidation` or the working-hours API route).
 * `date` is collapsed from Prisma's UTC-midnight Date to an absolute
 * "YYYY-MM-DD" string so downstream comparisons cannot re-interpret it in a
 * local timezone.
 */
export type NormalizedWorkingHoursOverride = Omit<
  WorkingHoursOverride,
  "date"
> & {
  date: string;
};

export interface WorkingHoursData {
  enabled: boolean;
  weeklySchedule: WeeklyScheduleJson;
  // At runtime, `date` may arrive as a Prisma `Date` (server-side raw Prisma
  // payload) or as a normalized YYYY-MM-DD string (post-normalize, post-API);
  // both forms are accepted because every comparison site funnels through
  // `getOverrideDateKey`.
  overrides: Array<WorkingHoursOverride | NormalizedWorkingHoursOverride>;
}

export interface WorkingHoursSchedule extends TimeSlot {
  id: string;
  workingHoursId: string;
  dayOfWeek: DayOfWeek;
  isOpen: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Comprehensive working hours with all related data
export type WorkingHoursWithOverrides = Prisma.WorkingHoursGetPayload<{
  include: {
    overrides: true;
  };
}>;

// For API requests/responses
export interface CreateWorkingHoursRequest {
  organizationId: string;
  enabled: boolean;
  schedules: Array<{
    dayOfWeek: DayOfWeek;
    isOpen: boolean;
    openTime?: string | null; // wall-clock "HH:MM" — see docblock above DaySchedule.
    closeTime?: string | null; // wall-clock "HH:MM" — see docblock above DaySchedule.
  }>;
}

export interface CreateOverrideRequest {
  workingHoursId: string;
  date: string; // ISO date string
  isOpen: boolean;
  openTime?: string | null; // wall-clock "HH:MM" — see docblock above DaySchedule.
  closeTime?: string | null; // wall-clock "HH:MM" — see docblock above DaySchedule.
  reason?: string;
}

export interface UpdateScheduleRequest {
  scheduleId: string;
  isOpen: boolean;
  openTime?: string | null; // wall-clock "HH:MM" — see docblock above DaySchedule.
  closeTime?: string | null; // wall-clock "HH:MM" — see docblock above DaySchedule.
}

// Utility types for business logic
export interface BusinessHoursCheck {
  isOpen: boolean;
  openTime?: string; // wall-clock "HH:MM" — see docblock above DaySchedule.
  closeTime?: string; // wall-clock "HH:MM" — see docblock above DaySchedule.
  source: "schedule" | "override";
  reason?: string; // Only present if from override
}

export interface BookingTimeValidation {
  isValid: boolean;
  conflicts: Array<{
    type: "outside_hours" | "closed_day" | "override_closure";
    message: string;
    suggestedTime?: {
      start: string; // wall-clock "HH:MM" — see docblock above DaySchedule.
      end: string; // wall-clock "HH:MM" — see docblock above DaySchedule.
    };
  }>;
}

// Time validation utilities
export type TimeString = `${number}${number}:${number}${number}`; // "HH:MM" format
export const TIME_FORMAT_REGEX = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;

export interface TimeValidation {
  isValid: boolean;
  parsed?: {
    hours: number;
    minutes: number;
  };
  error?: string;
}
