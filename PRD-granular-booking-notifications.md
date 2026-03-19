# PRD: Granular Booking Email Notifications

## Problem Statement

Currently, Shelf sends booking email notifications with a rigid, all-or-nothing approach:

- **Custodian** receives emails for all booking events (reserved, checkout reminder, checkin reminder, overdue, completed, cancelled, extended, updated, deleted)
- **All admins + owner** receive a notification **only** when a non-admin/non-owner user reserves a booking
- **Booking creator** does not receive notifications (unless they are the custodian)
- **No settings exist** to control who gets notified, at any level

This causes two problems:

1. **Too much noise**: In organizations with many admins, every admin gets reservation emails even if only one person manages bookings
2. **Not enough coverage**: The booking creator gets no notifications about their own bookings. There's no way to add "responsible people" who should stay informed about a specific booking

Users have no agency over notification recipients — they can't reduce noise or add coverage.

## Goals

1. **User agency**: Give workspace admins control over who receives booking notifications
2. **Simple yet powerful**: Two levels of control (workspace defaults + per-booking overrides) without overwhelming complexity
3. **Backward compatible**: Current behavior is preserved as the default — no degradation for existing users
4. **Always-on safety net**: Custodian always receives notifications (non-negotiable)

## Non-Goals

- Per-user personal notification preferences (e.g., "I don't want emails") — future consideration
- Per-event-type granularity (e.g., "notify admins for overdue but not for checkout") — future consideration
- Non-email channels (Slack, in-app, SMS) — future consideration
- Notification frequency/digest settings — future consideration

---

## Current Behavior (Baseline)

| Booking Event     | Custodian | Creator | Admins + Owner                               | Additional Recipients |
| ----------------- | --------- | ------- | -------------------------------------------- | --------------------- |
| Reserved          | Yes       | No      | Yes (only if custodian is SELF_SERVICE/BASE) | No                    |
| Checkout Reminder | Yes       | No      | No                                           | No                    |
| Checkin Reminder  | Yes       | No      | No                                           | No                    |
| Overdue           | Yes       | No      | No                                           | No                    |
| Completed         | Yes       | No      | No                                           | No                    |
| Cancelled         | Yes       | No      | No                                           | No                    |
| Extended          | Yes       | No      | No                                           | No                    |
| Updated           | Yes       | No      | No                                           | No                    |
| Deleted           | Yes       | No      | No                                           | No                    |

**Key gaps:**

- Creator never gets notified (even when different from custodian)
- Admins only get notified on reservation, and only when custodian is a lower-role user
- No way to add specific people to a booking's notification list
- No way to reduce admin notifications

---

## Proposed Solution

### Design Principles

1. **Additive recipient model**: Start with mandatory recipients, then layer on optional ones
2. **Workspace defaults + per-booking overrides**: Two clean levels, no more
3. **Role-agnostic user selection**: "Always notify" is based on selecting specific users, not roles
4. **Sensible defaults**: Ship with backward-compatible defaults so existing users see no change

### Recipient Resolution Order

For every booking email, recipients are determined by combining these layers:

```
MANDATORY (cannot be turned off)
├── Custodian (always, all events)
│
WORKSPACE DEFAULTS (configured in Settings > Bookings)
├── Booking creator (on by default, can be toggled off — all events)
├── All admins broadcast (on by default — RESERVATION EVENT ONLY)
├── "Always notify" user list (additive — all events)
│
PER-BOOKING OVERRIDES (configured on each booking)
└── Notification recipients (additive — all events)
```

Recipients are **deduplicated** before sending — no one receives the same email twice.

**Key insight — broadcast vs. targeted notifications:**

The "notify all admins" setting is a **broadcast for the reservation event only**. Its purpose is to alert the admin team that a new booking needs attention ("someone pick this up"). Once the booking is in motion, only people explicitly attached to it (custodian, creator, always-notify users, per-booking recipients) should receive lifecycle notifications.

This prevents the common complaint: "I'm an admin but I don't need emails about every checkout and checkin for bookings I'm not involved in."

If an admin wants to follow a specific booking after the reservation broadcast, they add themselves as a **notification recipient** on that booking. If an admin wants to follow ALL bookings (like the office manager case), they get added to the **"always notify" user list** at workspace level.

### Workspace-Level Settings

Added to the **Settings > Bookings** page, in a new "Notification Recipients" section:

#### Setting 1: Notify booking creator

- **Type**: Toggle (boolean)
- **Default**: ON
- **Behavior**: When ON, the user who created a booking receives all email notifications for that booking (if they are not already the custodian)
- **Rationale**: The person who created the booking is often responsible for it, even if they assigned a different custodian

#### Setting 2: Notify all admins on new booking requests

- **Type**: Toggle (boolean)
- **Default**: ON (backward compatible)
- **Behavior**: When ON, all users with OWNER or ADMIN role receive an email notification **only when a booking is reserved** (the "new booking request" event). They do NOT receive subsequent lifecycle emails (checkout, checkin, overdue, cancelled, etc.) unless they are explicitly added as a notification recipient on the booking or are in the "always notify" list
- **Rationale**: The reservation broadcast is a "pickup" signal — it alerts the admin team that a new booking needs attention. Once someone takes ownership, only they should follow the booking. This matches current behavior precisely (admins currently only get the reservation email) while making it configurable

#### Setting 3: Always notify specific users

- **Type**: Multi-select user picker
- **Default**: Empty
- **Behavior**: Selected users receive ALL booking email notifications, regardless of the admin toggle above. Works additively — if the admin toggle is ON, these users are notified in addition to admins. If OFF, only these specific users are notified (plus custodian + creator if enabled)
- **Rationale**: Covers the case where one specific person (e.g., an office manager who happens to be an admin) wants to receive all notifications without flooding every admin

### Per-Booking Overrides

On the booking creation and edit forms, a new optional field:

#### Additional notification recipients

- **Type**: Multi-select user picker (same component as workspace setting)
- **Behavior**: Selected users receive email notifications for this specific booking only. Additive to workspace defaults
- **Rationale**: For specific bookings that need extra eyes — e.g., a high-value equipment checkout that the department head should know about

### Complete Recipient Matrix (New Behavior)

| Booking Event     | Custodian | Creator       | All Admins (broadcast) | Always-Notify Users    | Per-Booking Recipients |
| ----------------- | --------- | ------------- | ---------------------- | ---------------------- | ---------------------- |
| Reserved          | Always    | If setting ON | **If setting ON**      | Always (if configured) | Always (if configured) |
| Checkout Reminder | Always    | If setting ON | No                     | Always (if configured) | Always (if configured) |
| Checkin Reminder  | Always    | If setting ON | No                     | Always (if configured) | Always (if configured) |
| Overdue           | Always    | If setting ON | No                     | Always (if configured) | Always (if configured) |
| Completed         | Always    | If setting ON | No                     | Always (if configured) | Always (if configured) |
| Cancelled         | Always    | If setting ON | No                     | Always (if configured) | Always (if configured) |
| Extended          | Always    | If setting ON | No                     | Always (if configured) | Always (if configured) |
| Updated           | Always    | If setting ON | No                     | Always (if configured) | Always (if configured) |
| Deleted           | Always    | If setting ON | No                     | Always (if configured) | Always (if configured) |

**The "All Admins" column only applies to the reservation event.** This is the broadcast/"pickup" signal. All other lifecycle events are targeted to specific people attached to the booking.

The "Always-Notify Users" and "Per-Booking Recipients" columns apply to ALL events — these are people who have explicitly opted in to follow bookings.

---

## Data Model Changes

### 1. Extend `BookingSettings` model

```prisma
model BookingSettings {
  // ... existing fields ...

  // Notification settings
  notifyBookingCreator       Boolean @default(true)
  notifyAdminsOnNewBooking   Boolean @default(true)

  // Many-to-many: users who always receive booking notifications
  alwaysNotifyUsers          BookingSettingsAlwaysNotifyUser[]
}
```

### 2. New join table for "always notify" users

```prisma
model BookingSettingsAlwaysNotifyUser {
  id                String          @id @default(cuid())

  bookingSettings   BookingSettings @relation(fields: [bookingSettingsId], references: [id], onDelete: Cascade)
  bookingSettingsId String

  user              User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId            String

  createdAt         DateTime        @default(now())

  @@unique([bookingSettingsId, userId])
}
```

### 3. New join table for per-booking additional recipients

```prisma
model BookingNotificationRecipient {
  id        String   @id @default(cuid())

  booking   Booking  @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  bookingId String

  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId    String

  createdAt DateTime @default(now())

  @@unique([bookingId, userId])
}
```

### 4. Update `Booking` model

```prisma
model Booking {
  // ... existing fields ...

  // Per-booking notification recipients
  notificationRecipients BookingNotificationRecipient[]
}
```

### Migration Notes

- Both new boolean fields default to `true`, so existing organizations keep current behavior
- No data migration needed — empty `alwaysNotifyUsers` + `notifyAdminsOnNewBooking: true` = current behavior
- The admin broadcast is scoped to reservation only, which **exactly matches** current behavior (admins currently only get notified on reservation). No behavioral change for existing users

---

## UI/UX Design

### Settings > Bookings Page

Add a new section **"Email Notification Recipients"** below the existing booking settings:

```
┌─────────────────────────────────────────────────────────┐
│  Email Notification Recipients                          │
│                                                         │
│  Configure who receives email notifications for         │
│  booking events in this workspace.                      │
│                                                         │
│  ┌─ Info box (blue) ──────────────────────────────┐     │
│  │ The booking custodian always receives all       │     │
│  │ notifications. These settings control who else  │     │
│  │ gets notified. You can also add per-booking     │     │
│  │ recipients when creating or editing a booking.  │     │
│  └────────────────────────────────────────────────┘     │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │ ☑ Notify booking creator                        │    │
│  │   When someone creates a booking on behalf of   │    │
│  │   another person, the creator will receive all  │    │
│  │   email updates for that booking.               │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │ ☑ Notify all admins on new booking requests     │    │
│  │   When a booking is reserved, all workspace     │    │
│  │   admins receive a notification so someone can  │    │
│  │   review and handle the request. Admins will    │    │
│  │   NOT receive subsequent updates (checkout,     │    │
│  │   checkin, etc.) unless they are added as a     │    │
│  │   notification recipient on the booking.        │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  Always notify these users                              │
│  ┌─────────────────────────────────────────────────┐    │
│  │ [Carlos M.] [x]  [Sarah K.] [x]                │    │
│  │ + Add user                                      │    │
│  └─────────────────────────────────────────────────┘    │
│  These users receive ALL booking email notifications    │
│  for every booking in this workspace — not just the     │
│  reservation, but every update. Use this for people     │
│  who need complete visibility, like an office manager   │
│  or operations lead.                                    │
│                                                         │
│  [Save]                                                 │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**UI documentation principles:**

- Every setting must have a clear, plain-language description of what it does
- Use concrete examples ("like an office manager") to help users understand when to use a feature
- Explain what does NOT happen (e.g., "admins will NOT receive subsequent updates") to prevent confusion
- The info box at the top anchors the mental model: custodian is always notified, these settings are for everyone else

### Booking Form (Create/Edit)

Add an optional collapsible section **"Notification recipients"** after the existing booking fields:

```
┌─────────────────────────────────────────────────────────┐
│  Notification recipients (optional)              [▼]    │
│                                                         │
│  Add people who should receive email updates about      │
│  this booking (checkout, checkin, overdue, etc.):       │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │ [Maria G.] [x]  [James R.] [x]                 │    │
│  │ + Add recipient                                 │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  ┌─ Notification preview (visible to admin/owner) ─┐   │
│  │ This booking will notify:                        │   │
│  │  • Alex T. (custodian)                           │   │
│  │  • You (creator)                                 │   │
│  │  • Carlos M. (always notified)                   │   │
│  │  • Maria G., James R. (added above)              │   │
│  │  + 3 admins will be notified on reservation      │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Notification preview:**

- **Visible only to users with ADMIN or OWNER role** — base/self-service users should not see the full recipient list (privacy)
- Shows a computed, real-time summary of who will be notified and why
- Groups recipients by reason (custodian, creator, always-notified, per-booking, admins)
- For the admin broadcast, shows count only ("+ 3 admins will be notified on reservation") rather than listing names
- Updates dynamically as the user adds/removes per-booking recipients

**User picker requirements:**

- Search organization members by name/email
- Show the user's role as a subtle badge (for context, not for filtering)
- Exclude the custodian (already mandatory)
- Show already-selected users as removable chips
- Only show users who have an email address (no point adding someone who can't receive email)

---

## Email Sending Logic Changes

### New helper: `getBookingNotificationRecipients()`

Central function that resolves the complete recipient list for any booking email:

```typescript
async function getBookingNotificationRecipients({
  booking, // Booking with custodianUser, creator, org relations
  organizationId,
  eventType, // The booking event triggering this notification
  editorUserId, // The user performing the action (excluded from immediate emails)
  isScheduled, // true for scheduled events (reminders, overdue) — editor NOT excluded
}: {
  booking: BookingForEmail;
  organizationId: string;
  eventType: BookingNotificationEvent;
  editorUserId?: string;
  isScheduled?: boolean;
}): Promise<string[]> {
  const recipients = new Set<string>();

  // 1. MANDATORY: Custodian (always, all events)
  if (booking.custodianUser?.email) {
    recipients.add(booking.custodianUser.email);
  }

  // 2. Fetch workspace notification settings
  const settings = await getBookingSettingsForOrganization(organizationId);

  // 3. WORKSPACE DEFAULT: Creator (if enabled)
  if (settings.notifyBookingCreator && booking.creator?.email) {
    recipients.add(booking.creator.email);
  }

  // 4. WORKSPACE DEFAULT: All admins — RESERVATION EVENT ONLY
  //    This is the "broadcast for pickup" — admins get alerted that a new
  //    booking needs attention. They do NOT get subsequent lifecycle emails
  //    unless they are explicitly added as a notification recipient.
  if (settings.notifyAdminsOnNewBooking && eventType === "RESERVED") {
    const adminEmails = await getOrganizationAdminsEmails({ organizationId });
    adminEmails.forEach((email) => recipients.add(email));
  }

  // 5. WORKSPACE DEFAULT: Always-notify users (ALL events)
  const alwaysNotify = await getAlwaysNotifyUsers(settings.id);
  alwaysNotify.forEach((user) => {
    if (user.email) recipients.add(user.email);
  });

  // 6. PER-BOOKING: Notification recipients (ALL events)
  const bookingRecipients = await getBookingNotificationRecipientUsers(
    booking.id
  );
  bookingRecipients.forEach((user) => {
    if (user.email) recipients.add(user.email);
  });

  // 7. EXCLUDE: The person performing the action
  //    They already know what they did — no need for an email.
  //    Exception: scheduled events (reminders, overdue) always send to everyone.
  if (editorUserId && !isScheduled) {
    const editorEmail = await getUserEmail(editorUserId);
    if (editorEmail) {
      recipients.delete(editorEmail);
    }
  }

  return Array.from(recipients).filter(Boolean);
}
```

### Updating existing email sending

Every place that currently calls `sendEmail()` for a booking event needs to be updated to:

1. Call `getBookingNotificationRecipients()` instead of hardcoding `booking.custodianUser.email`
2. Send to all resolved recipients (as BCC or individual emails — see Email Delivery section)
3. Remove the special-case admin notification in `reserveBooking()` (replaced by the general mechanism)

### Email Delivery Strategy

**Option A: Single email with BCC** (simpler)

- Send one email, put all recipients in BCC
- Pro: One email send per event
- Con: Can't personalize greeting per recipient

**Option B: Individual emails per recipient** (recommended)

- Send separate emails to each recipient
- Pro: Can personalize ("Hey Sarah," vs "Hey Carlos,")
- Pro: Each recipient sees only their own email address
- Pro: Delivery failures are isolated
- Con: More email sends

**Recommendation: Option B** — individual emails per recipient. The current system already sends individual emails (one to custodian, one to admins). The personalized greeting ("Hey {firstName},") is important for the Shelf email design language.

### Email Template Adjustments

The existing `bookings-updates-template.tsx` works for all recipients. Minor additions:

- For admin/always-notify recipients: Add a subtle line indicating why they received this email (e.g., "You're receiving this because you're set as a notification recipient for bookings in [Workspace Name]")
- This helps recipients understand why they're getting the email and where to change it

---

## Edge Cases & Decisions

### 1. Creator is the custodian

No duplicate email. The `Set` deduplication handles this automatically.

### 2. Creator is an admin AND admin broadcast is on

No duplicate email on reservation. Same deduplication. For subsequent events, they receive as "creator" only (not as admin, since admin broadcast is reservation-only).

### 3. User is in "always notify" list AND is an admin AND admin broadcast is on

No duplicate email on reservation. Same deduplication. For subsequent events, they receive as "always notify" user.

### 4. User is removed from organization

`onDelete: Cascade` on the join tables ensures cleanup. No orphaned notification recipients.

### 5. "Always notify" user has no email

Silently skip (same as current custodian behavior).

### 6. Team member custodian (no user account)

Current behavior: no email sent to team member custodians. This PRD does not change that — team members without user accounts cannot receive email. The rest of the recipient list (creator, admins, always-notify, per-booking) still gets notified.

### 7. Editor exclusion

Current behavior: if the custodian is the person making the change, they don't get an email. We should apply the same logic to all recipients — if you're the one performing the action, you don't need an email about it. **However**, this should only apply to the immediate action email, not to scheduled reminders (checkout reminder, checkin reminder, overdue).

### 8. Personal workspaces

Notification settings are not available for PERSONAL workspace type (consistent with other settings). The default behavior applies.

### 9. Backward compatibility

- `notifyBookingCreator: true` (default) — new behavior (creator now gets notified), but additive and universally beneficial
- `notifyAdminsOnNewBooking: true` (default) — **exactly matches** current behavior (admins currently only get the reservation email)
- Empty `alwaysNotifyUsers` — no change
- Empty per-booking recipients — no change

The only behavioral change for existing users: **booking creators now receive notifications**. This is additive and beneficial. Admin behavior is unchanged — they still only get the reservation email, same as today.

### 10. High-volume notification warning

When the admin broadcast toggle is ON and the organization has many admins, the settings UI should display a note: "Your workspace has X admins. Notification emails may be slightly delayed during high-volume periods." No hard cap — just transparent communication.

---

## Implementation Phases

### Phase 1: Data Model + Backend Logic

1. Add Prisma schema changes (new fields + join tables)
2. Create migration
3. Implement `getBookingNotificationRecipients()` helper
4. Update all email sending points to use the new helper
5. Remove the special-case admin notification in `reserveBooking()`
6. Add service functions for managing always-notify users and per-booking recipients

### Phase 2: Workspace Settings UI

1. Add "Email Notification Recipients" section to Settings > Bookings
2. Implement toggle controls for `notifyBookingCreator` and `notifyAdminsOnNewBooking`
3. Implement user picker for "always notify" list
4. Wire up form submission to update BookingSettings
5. Add clear descriptions, info box, and high-volume admin warning

### Phase 3: Per-Booking UI

1. Add "Notification recipients" section to booking create form
2. Add same section to booking edit form
3. Implement user picker (reuse component from Phase 2)
4. Wire up to create/update BookingNotificationRecipient records
5. Add notification preview panel (admin/owner only, with privacy gating)

### Phase 4: Email Template Polish

1. Add "why you received this" line for non-custodian recipients
2. Ensure email personalization works for all recipient types
3. Test all 9 booking events x all recipient types

---

## Success Metrics

- **No regressions**: Existing users continue receiving the same (or better) notifications without any configuration
- **Adoption**: >20% of team workspaces configure custom notification settings within 3 months
- **Reduced noise**: Organizations that configure settings report fewer unwanted notification emails
- **Coverage**: Booking creators now receive notifications (new capability, universally beneficial)

---

## Resolved Decisions

1. **Editor exclusion applies to all recipients.** If you perform an action (checkout, checkin, cancel, etc.), you don't get an email about it — you already know. Exception: scheduled events (checkout reminder, checkin reminder, overdue) always send to everyone regardless of who the original editor was.

2. **Notification preview is included in MVP.** Shown on the booking form, visible only to ADMIN/OWNER users (privacy). Displays a computed summary of who will be notified and why, grouped by reason. For the admin broadcast, shows count only ("+ 3 admins on reservation") to keep it concise for large orgs.

3. **Admin broadcast is reservation-only.** Admins receive the reservation email as a "pickup" signal. They do NOT receive subsequent lifecycle emails unless explicitly added as a notification recipient on the booking or in the "always notify" list. This exactly matches current behavior and prevents noise.

4. **No rate limiting, just transparency.** When the admin broadcast is on and the org has many admins, show a note in the settings UI: "Your workspace has X admins. Notification emails may be slightly delayed during high-volume periods." No hard cap.

5. **Email subjects stay the same for all recipients.** Differentiation happens in the email body with a "why you received this" line for non-custodian recipients. Same subject keeps inbox threading clean.
