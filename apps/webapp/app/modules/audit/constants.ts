import type { Prisma } from "@prisma/client";

/** Includes needed for audit to have all data required for emails */
export const AUDIT_INCLUDE_FOR_EMAIL = {
  createdBy: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      displayName: true,
      email: true,
      // Format-preference columns so the email fan-out resolves each recipient's
      // date/time formatting from the loaded row (no per-recipient DB fetch).
      dateFormat: true,
      timeFormat: true,
      weekStart: true,
      timeZone: true,
    },
  },
  assignments: {
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          displayName: true,
          email: true,
          // Carried for recipient-specific email formatting (see `createdBy`).
          dateFormat: true,
          timeFormat: true,
          weekStart: true,
          timeZone: true,
        },
      },
    },
  },
  organization: {
    include: {
      owner: {
        select: { email: true },
      },
    },
  },
  _count: {
    select: { assets: true },
  },
} satisfies Prisma.AuditSessionInclude;

/**
 * This enum represents the types of different events that can be scheduled for an audit using PgBoss
 */
export enum AUDIT_SCHEDULER_EVENTS_ENUM {
  reminder24h = `audit-reminder-24h`,
  reminder4h = `audit-reminder-4h`,
  reminder1h = `audit-reminder-1h`,
  overdueNotice = `audit-overdue-notice`,
}
