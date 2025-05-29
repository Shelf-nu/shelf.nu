import type { Prisma } from "@prisma/client";

// TypeScript types for JSON schedule
export interface DaySchedule {
  isOpen: boolean;
  openTime?: string; // "HH:MM" format (24-hour) in UTC
  closeTime?: string; // "HH:MM" format (24-hour) in UTC
}

export interface WeeklyScheduleJson {
  [dayOfWeek: string]: DaySchedule; // "0" through "6"
}

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
  openTime: string | null; // Format: "HH:MM" (24-hour) in UTC
  closeTime: string | null; // Format: "HH:MM" (24-hour) in UTC
}

export interface WorkingHoursConfig {
  id: string;
  organizationId: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkingHoursSchedule extends TimeSlot {
  id: string;
  workingHoursId: string;
  dayOfWeek: DayOfWeek;
  isOpen: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkingHoursOverride extends TimeSlot {
  id: string;
  workingHoursId: string;
  date: Date;
  isOpen: boolean;
  reason?: string | null;
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
    openTime?: string | null; // "HH:MM" format (24-hour) in UTC
    closeTime?: string | null; // "HH:MM" format (24-hour) in UTC
  }>;
}

export interface CreateOverrideRequest {
  workingHoursId: string;
  date: string; // ISO date string
  isOpen: boolean;
  openTime?: string | null; // "HH:MM" format (24-hour) in UTC
  closeTime?: string | null; // "HH:MM" format (24-hour) in UTC
  reason?: string;
}

export interface UpdateScheduleRequest {
  scheduleId: string;
  isOpen: boolean;
  openTime?: string | null; // "HH:MM" format (24-hour) in UTC
  closeTime?: string | null; // "HH:MM" format (24-hour) in UTC
}

// Utility types for business logic
export interface BusinessHoursCheck {
  isOpen: boolean;
  openTime?: string; // "HH:MM" format (24-hour) in UTC
  closeTime?: string; // "HH:MM" format (24-hour) in UTC
  source: "schedule" | "override";
  reason?: string; // Only present if from override
}

export interface BookingTimeValidation {
  isValid: boolean;
  conflicts: Array<{
    type: "outside_hours" | "closed_day" | "override_closure";
    message: string;
    suggestedTime?: {
      start: string; // "HH:MM" format (24-hour) in UTC
      end: string; // "HH:MM" format (24-hour) in UTC
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
