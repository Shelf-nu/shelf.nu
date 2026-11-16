/**
 * Settings Card Anchors
 *
 * The `id` of every card on the workspace settings pages, so a card can be
 * linked to directly: `/settings/bookings#automation` opens the Bookings tab
 * scrolled to the Automation card. React Router's `ScrollRestoration` (in
 * `root.tsx`) scrolls to the element named by the URL hash, on a fresh load
 * and on in-app navigation, so a card only needs a stable `id`.
 *
 * These ids are public URLs: people paste them into support replies, docs
 * and chat. Renaming one silently breaks every link already shared, so treat
 * a value here as fixed once released, even when the card's title changes.
 *
 * @see {@link file://./../components/shared/card.tsx}
 * @see {@link file://./../routes/_layout+/settings.bookings.tsx}
 * @see {@link file://./../routes/_layout+/settings.general.tsx}
 * @see {@link file://./../routes/_layout+/settings.emails.tsx}
 */

/** Card anchors on `/settings/general` */
export const GENERAL_SETTINGS_ANCHORS = {
  general: "general",
  permissions: "permissions",
  sso: "sso",
  scim: "scim",
  transferOwnership: "transfer-ownership",
} as const;

/** Card anchors on `/settings/bookings` */
export const BOOKING_SETTINGS_ANCHORS = {
  notifications: "notifications",
  explicitCheckin: "explicit-check-in",
  explicitCheckout: "explicit-check-out",
  countingOptions: "counting-options",
  tagsRequirement: "tags-requirement",
  automation: "automation",
  timeRestrictions: "time-restrictions",
  workingHours: "working-hours",
  weeklySchedule: "weekly-schedule",
  dateOverrides: "date-overrides",
  pdfTemplates: "pdf-templates",
} as const;

/** Card anchors on `/settings/emails` */
export const EMAIL_SETTINGS_ANCHORS = {
  customEmailFooter: "custom-email-footer",
} as const;
