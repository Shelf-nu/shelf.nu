/**
 * This enum represents the types of different events that can be scheduled for an audit using PgBoss
 */
export enum AUDIT_SCHEDULER_EVENTS_ENUM {
  reminder24h = `audit-reminder-24h`,
  reminder4h = `audit-reminder-4h`,
  reminder1h = `audit-reminder-1h`,
  overdueNotice = `audit-overdue-notice`,
}
