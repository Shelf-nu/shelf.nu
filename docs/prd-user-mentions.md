# Product Requirements Document: User Mentions in Activity Logs

**Version**: 1.0
**Last Updated**: 2026-01-09
**Status**: Draft

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Goals & Objectives](#goals--objectives)
3. [User Stories](#user-stories)
4. [Feature Requirements](#feature-requirements)
5. [Technical Architecture](#technical-architecture)
6. [Data Models](#data-models)
7. [UI/UX Specifications](#ui--ux-specifications)
8. [Integration Points](#integration-points)
9. [Security & Permissions](#security--permissions)
10. [Edge Cases & Error Handling](#edge-cases--error-handling)
11. [Testing Strategy](#testing-strategy)
12. [Complexity Rankings](#complexity-rankings)
13. [Success Metrics](#success-metrics)
14. [Open Questions](#open-questions)

---

## Executive Summary

This PRD outlines the implementation of @mentions functionality in Shelf.nu activity logs, enabling users to tag team members in asset and booking comments. When mentioned, users will receive email notifications and persistent in-app notifications via a bell icon badge, fostering better collaboration and communication around asset management activities.

The feature integrates with Shelf's existing:

- Activity log system (Note and BookingNote models)
- Notification infrastructure (database-backed notifications and email system)
- Permission system (organization-based access control)
- Markdown rendering pipeline (Markdoc with custom tags)

---

## Goals & Objectives

### Primary Goals

1. Enable users to explicitly notify team members about important asset/booking activities
2. Improve team collaboration and communication within organizations
3. Reduce missed updates by providing targeted notifications
4. Create an audit trail of team discussions around assets and bookings

### Secondary Goals

1. Leverage existing notification infrastructure to minimize complexity
2. Provide a familiar UX pattern (similar to Slack, GitHub, etc.)
3. Support multiple mentions per comment
4. Enable quick access to mentioned context from notifications

### Non-Goals (Out of Scope)

1. @channel or @all mentions (broadcast to entire team)
2. Mentions in asset/booking descriptions or custom fields
3. @mentions in system-generated UPDATE notes (only in COMMENT notes)
4. Cross-organization mentions
5. Real-time SSE toast notifications (using database-backed notifications instead)
6. Email batching in Phase 1 (defer to Phase 2)

---

## User Stories

### As an Asset Manager

- I want to @mention a team member when commenting on an asset, so they are notified about an important issue or update
- I want to @mention multiple people in a single comment to involve them in a discussion
- I want to see who has been mentioned in a comment thread
- I want to receive a notification when someone mentions me in an asset comment

### As a Booking Coordinator

- I want to @mention the custodian in a booking comment to alert them about special instructions
- I want to @mention an admin when I need help resolving a booking conflict
- I want to see a list of available team members as I type a mention

### As a Team Member

- I want to receive an email when someone mentions me if I'm not online
- I want to click a notification and be taken directly to the relevant asset/booking
- I want to see all mentions in a comment clearly highlighted
- I want to be able to mention both registered users and myself

### As a Self-Service User

- I can mention other team members in my bookings
- I can only mention users within my organization
- I cannot mention users from other organizations

---

## Feature Requirements

### FR-1: Mention Input Component

**Description**: Rich text input that detects "@" character and shows user picker

**Requirements**:

- FR-1.1: Detect "@" character typed in comment textarea
- FR-1.2: Display dropdown menu of mentionable users after "@"
- FR-1.3: Filter user list as user continues typing after "@"
- FR-1.4: Show user avatar, full name, and role in dropdown
- FR-1.5: Support keyboard navigation (arrow keys, enter to select, escape to close)
- FR-1.6: Support mouse/touch selection
- FR-1.7: Insert mention as markdown link: `@[John Doe](mention://user-id)`
- FR-1.8: Prevent mentions of deleted/disabled users
- FR-1.9: Only show users from current organization
- FR-1.10: Sort users alphabetically by name
- FR-1.11: Show "No users found" when filter yields no results
- FR-1.12: Support multiple mentions in single comment
- FR-1.13: Handle edge cases (@ at start, middle, end of text)

**Dependencies**:

- Current organization context
- User list API endpoint
- Text input component for comments

---

### FR-2: Mention Rendering

**Description**: Display mentions with visual distinction in rendered comments

**Requirements**:

- FR-2.1: Render mentions as styled links (e.g., blue text, bold, or badge-like)
- FR-2.2: Show user full name in mention
- FR-2.3: Make mentions clickable, linking to user profile or team member page
- FR-2.4: Support hover state showing user details (avatar, role, email)
- FR-2.5: Handle deleted user mentions gracefully (show name but disable link)
- FR-2.6: Render mentions in both asset and booking comments
- FR-2.7: Render mentions in CSV exports as plain text
- FR-2.8: Use existing Markdoc infrastructure for parsing and rendering

**Dependencies**:

- Markdoc custom tag system
- User data resolution
- Markdown viewer component

---

### FR-3: Mention Parsing & Storage

**Description**: Parse mentions from markdown and store references

**Requirements**:

- FR-3.1: Parse mention syntax from comment markdown: `@[Name](mention://user-id)`
- FR-3.2: Extract all mentioned user IDs from comment content
- FR-3.3: Store mention references in new `NoteMention` junction table
- FR-3.4: Validate mentioned users exist in organization
- FR-3.5: Create mention records atomically with note creation
- FR-3.6: Support updating mentions when comment is edited (if editing is added later)
- FR-3.7: Delete mention records when comment is deleted
- FR-3.8: Handle malformed mention syntax gracefully (treat as regular text)

**Dependencies**:

- Database migration
- Note/BookingNote creation services
- Markdown parsing utilities

---

### FR-4: In-App Notifications

**Description**: Persistent notification center with bell icon badge when user is mentioned

**Requirements**:

- FR-4.1: Create persistent notification record in database when user is mentioned
- FR-4.2: Show bell icon in header with unread count badge
- FR-4.3: Badge displays number of unread mentions (max "9+" for 10 or more)
- FR-4.4: Clicking bell opens dropdown with recent mentions
- FR-4.5: Each notification shows: mentioner name, asset/booking name, timestamp
- FR-4.6: Notification includes deep link to specific comment
- FR-4.7: Do not create notification for user who authored the mention
- FR-4.8: Support multiple notifications if mentioned in multiple comments
- FR-4.9: Clicking notification navigates to asset/booking activity tab and marks as read
- FR-4.10: Notifications persist across sessions (database-backed)
- FR-4.11: Show unread indicator (blue dot) for unread mentions

**Dependencies**:

- MentionNotification database model
- Header component updates
- Notification dropdown component

---

### FR-5: Email Notifications

**Description**: Email alert when user is mentioned (via Resend SDK)

**Requirements**:

- FR-5.1: Send email to mentioned user's registered email address via Resend SDK
- FR-5.2: Email subject: "[Shelf.nu] [Mentioner] mentioned you in [Asset/Booking Name]"
- FR-5.3: Email body includes:
  - Who mentioned you
  - Where (asset/booking name with link)
  - Comment content (with mentions highlighted)
  - CTA button to view full context
- FR-5.4: Email includes both HTML and plain text versions
- FR-5.5: Use simple, clean email template (no complex design system needed)
- FR-5.6: Best-effort delivery (log failures, but don't retry - user still gets database notification)
- FR-5.7: Include organization name in email footer
- FR-5.8: Track email delivery success/failure in analytics table
- FR-5.9: Send immediately on mention creation (no batching in Phase 1)

**Dependencies**:

- Resend SDK (`resend` npm package)
- RESEND_API_KEY environment variable
- Email template component
- MentionAnalytics table for tracking

---

### FR-6: Notification Center (Phase 1 - Core Feature)

**Description**: Persistent list of mentions with bell icon badge

**Requirements**:

- FR-6.1: Show bell icon in header with unread count badge (included in FR-4)
- FR-6.2: Dropdown panel shows recent 10-20 mentions
- FR-6.3: Each notification shows: timestamp, mentioner, context link, read/unread status
- FR-6.4: Mark individual notifications as read (automatically on click)
- FR-6.5: Notifications load on page load (no real-time SSE updates)
- FR-6.6: Show blue dot indicator for unread mentions
- FR-6.7: Clicking notification navigates to booking activity and marks as read
- FR-6.8: Track notification views in analytics table

**Out of Scope for Phase 1** (defer to Phase 3):

- "Mark all as read" action
- Paginated list of all historical mentions
- Filter by read/unread status
- Filter by asset vs booking mentions
- Auto-cleanup of old notifications

**Dependencies**:

- MentionNotification model (database-backed)
- Header component modification
- Notification dropdown component

---

### FR-7: User Permissions & Privacy

**Description**: Ensure mentions respect organization boundaries and permissions

**Requirements**:

- FR-7.1: Users can only mention team members in their current organization
- FR-7.2: Self-service users can mention others in their own bookings
- FR-7.3: Cannot mention users from other organizations
- FR-7.4: Cannot mention disabled/deleted users
- FR-7.5: Mentioned users must have permission to view the asset/booking
- FR-7.6: Notify mentioned users even if they don't have direct permission (but log access)
- FR-7.7: Admin/Owner can see all mentions in their organization
- FR-7.8: Validate mention permissions on server side (not just client)

**Dependencies**:

- Permission system
- Organization context
- User validation service

---

### FR-8: API Endpoints

**Description**: Backend APIs to support mention functionality

**Requirements**:

- FR-8.1: `GET /api/mentions/users?organizationId=:id&query=:search`
  - Returns list of mentionable users
  - Filters by name/email matching query
  - Excludes deleted users
  - Includes: id, firstName, lastName, email, profilePicture, role

- FR-8.2: `POST /api/notes` (enhanced existing endpoint)
  - Parse mentions from content
  - Create NoteMention records
  - Trigger notifications

- FR-8.3: `GET /api/mentions/notifications?userId=:id`
  - Returns list of mention notifications
  - Paginated, sorted by timestamp
  - Includes read/unread status

- FR-8.4: `PATCH /api/mentions/notifications/:id/read`
  - Marks notification as read

- FR-8.5: `GET /api/mentions/unread-count?userId=:id`
  - Returns count of unread mention notifications

**Dependencies**:

- Remix loader/action functions
- Note service
- User service
- Notification service

---

### FR-9: Analytics & Audit

**Description**: Track mention usage for insights and learning (per-organization metrics)

**Requirements**:

- FR-9.1: Store daily aggregated analytics per organization in MentionAnalytics table
- FR-9.2: Track mention count (total mentions created per org per day)
- FR-9.3: Track email sent count (successful email deliveries per org per day)
- FR-9.4: Track email failed count (failed email deliveries per org per day)
- FR-9.5: Track notification view count (times users viewed their notification badge per org per day)
- FR-9.6: Track booking mention count vs asset mention count (separate counters for context)
- FR-9.7: Provide API to query org analytics (last 30 days, last 90 days, etc.)
- FR-9.8: Calculate email success rate (sent / (sent + failed) \* 100)
- FR-9.9: Support learning which notification channel is more effective (email vs badge engagement)

**Dependencies**:

- MentionAnalytics database model
- Analytics tracking functions (upsert pattern for daily aggregation)
- Logging infrastructure for errors

---

## Technical Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                         User Interface                           │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────┐ │
│  │ Mention Input    │  │ Mention Renderer │  │ Bell Icon +   │ │
│  │ Component        │  │ (Markdoc)        │  │ Badge         │ │
│  └──────────────────┘  └──────────────────┘  └───────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         API Layer (Remix)                        │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────┐ │
│  │ Note Actions     │  │ User Loader      │  │ Notification  │ │
│  │ (Create/Update)  │  │ (Mentionables)   │  │ API           │ │
│  └──────────────────┘  └──────────────────┘  └───────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Service Layer                              │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────┐ │
│  │ Note Service     │  │ Mention Service  │  │ Notification  │ │
│  │ (Create/Delete)  │  │ (Parse/Extract)  │  │ Service (DB)  │ │
│  └──────────────────┘  └──────────────────┘  └───────────────┘ │
│                              │                                   │
│  ┌──────────────────────────┴────────────────┐                 │
│  │         Mention Event Handler              │                 │
│  │  (Create DB notification + Send email)     │                 │
│  └──────────────────────────────────────────┘                  │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌──────────────┐    ┌──────────────┐      ┌──────────────┐
│   Database   │    │ Resend SDK   │      │  Analytics   │
│  (Prisma)    │    │ (Email API)  │      │   Tracking   │
└──────────────┘    └──────────────┘      └──────────────┘
```

### Data Flow: Creating a Mention

```
1. User types comment with @mention
   │
   ▼
2. Frontend: Mention picker shows users
   │
   ▼
3. User selects person → Insert markdown: @[Name](mention://user-id)
   │
   ▼
4. Submit comment → POST /api/notes
   │
   ▼
5. Backend: Parse mentions from markdown
   │
   ▼
6. Create BookingNote record (content includes mention markdown)
   │
   ▼
7. Create BookingNoteMention records (junction table)
   │
   ▼
8. Create MentionNotification record (status: UNREAD)
   │
   ▼
9. Track analytics → Increment mention count in MentionAnalytics
   │
   ▼
10. Send email via Resend SDK → Direct API call (<1s)
   │
   ▼
11. Track email delivery → Increment email sent/failed count
   │
   ▼
12. Next page load: Bell icon shows unread count badge
   │
   ▼
13. User clicks bell → Dropdown shows recent mentions
   │
   ▼
14. User clicks notification → Navigate + mark as read
```

---

## Data Models

### New Tables

#### NoteMention (for Asset Comments)

```prisma
model NoteMention {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())

  // Relations
  noteId         String
  note           Note   @relation(fields: [noteId], references: [id], onDelete: Cascade)

  mentionedUserId String
  mentionedUser   User   @relation("MentionedInNote", fields: [mentionedUserId], references: [id], onDelete: Cascade)

  mentionerId    String?
  mentioner      User?   @relation("MentionerInNote", fields: [mentionerId], references: [id], onDelete: SetNull)

  // Metadata
  assetId        String  // Denormalized for quick queries
  organizationId String  // Denormalized for filtering

  @@unique([noteId, mentionedUserId]) // Prevent duplicate mentions in same note
  @@index([mentionedUserId, createdAt]) // For user's mention feed
  @@index([assetId]) // For asset mention queries
  @@index([organizationId]) // For org-level analytics
}
```

#### BookingNoteMention (for Booking Comments)

```prisma
model BookingNoteMention {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())

  // Relations
  bookingNoteId  String
  bookingNote    BookingNote @relation(fields: [bookingNoteId], references: [id], onDelete: Cascade)

  mentionedUserId String
  mentionedUser   User   @relation("MentionedInBookingNote", fields: [mentionedUserId], references: [id], onDelete: Cascade)

  mentionerId    String?
  mentioner      User?   @relation("MentionerInBookingNote", fields: [mentionerId], references: [id], onDelete: SetNull)

  // Metadata
  bookingId      String  // Denormalized for quick queries
  organizationId String  // Denormalized for filtering

  @@unique([bookingNoteId, mentionedUserId]) // Prevent duplicate mentions
  @@index([mentionedUserId, createdAt]) // For user's mention feed
  @@index([bookingId]) // For booking mention queries
  @@index([organizationId]) // For org-level analytics
}
```

#### MentionNotification (Phase 1 - Database-Backed Notifications)

```prisma
enum NotificationStatus {
  UNREAD
  READ
  ARCHIVED
}

model MentionNotification {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // Core fields
  recipientId String
  recipient   User   @relation("ReceivedMentionNotifications", fields: [recipientId], references: [id], onDelete: Cascade)

  senderId    String?
  sender      User?   @relation("SentMentionNotifications", fields: [senderId], references: [id], onDelete: SetNull)

  status      NotificationStatus @default(UNREAD)
  readAt      DateTime?

  // Reference to mention (Phase 1: bookings only)
  bookingNoteMentionId String  @unique
  bookingNoteMention   BookingNoteMention @relation(fields: [bookingNoteMentionId], references: [id], onDelete: Cascade)

  // Denormalized for quick queries
  bookingId       String
  organizationId  String

  @@index([recipientId, status, createdAt]) // For notification feed
  @@index([recipientId, status]) // For unread count
  @@index([organizationId, createdAt]) // For org-level analytics
}
```

**Why This Model**:

- Persistent notification records (not ephemeral like SSE toasts)
- Per-user read/unread status tracking
- Efficient unread count queries via indexed fields
- Supports notification history and dropdown UI
- No dependency on SSE/EventEmitter
- Reuses pattern from Updates feature

#### MentionAnalytics (Phase 1 - Usage Tracking)

```prisma
model MentionAnalytics {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  date      DateTime @default(now()) @db.Date // Aggregation by date

  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  // Metrics
  mentionCount          Int @default(0) // Total mentions created
  emailSentCount        Int @default(0) // Emails successfully sent
  emailFailedCount      Int @default(0) // Emails that failed
  notificationViewCount Int @default(0) // Times notifications were viewed

  // Context breakdown
  bookingMentionCount Int @default(0) // Phase 1: bookings only
  assetMentionCount   Int @default(0) // Phase 2: assets (always 0 in Phase 1)

  @@unique([organizationId, date]) // One record per org per day
  @@index([organizationId, date])
  @@index([date]) // For global analytics
}
```

**Why This Schema**:

- Daily aggregation (not per-mention) - keeps table small and queries fast
- Supports "per org" analytics (user requirement)
- Tracks email success/failure rates for learning
- Separates booking vs asset mentions for Phase 2 comparison
- Can query total usage: `SUM(mentionCount) WHERE organizationId = X`
- Enables answering: "Is email or badge notification more effective?"

### Updated Models

```prisma
// Add to Note model
model Note {
  // ... existing fields
  mentions NoteMention[] // New relation
}

// Add to BookingNote model
model BookingNote {
  // ... existing fields
  mentions BookingNoteMention[] // New relation
}

// Add to User model
model User {
  // ... existing fields

  // Phase 1: Booking mentions only
  mentionedInBookingNotes BookingNoteMention[] @relation("MentionedInBookingNote")
  bookingMentionsCreated  BookingNoteMention[] @relation("MentionerInBookingNote")

  // Phase 1: Database-backed notifications
  mentionNotificationsReceived MentionNotification[] @relation("ReceivedMentionNotifications")
  mentionNotificationsSent     MentionNotification[] @relation("SentMentionNotifications")

  // Phase 2: Asset mentions (not in Phase 1)
  // mentionedInNotes        NoteMention[]        @relation("MentionedInNote")
  // noteMentionsCreated     NoteMention[]        @relation("MentionerInNote")
}

// Add to Organization model
model Organization {
  // ... existing fields

  // New relation for analytics
  mentionAnalytics MentionAnalytics[]
}
```

---

## UI/UX Specifications

### Mention Input Experience

**Component**: Enhanced comment textarea with mention picker

**Visual Design**:

```
┌─────────────────────────────────────────────────────────────┐
│ Add comment...                                              │
│                                                             │
│ Hey @joh|                                                   │
│       └─────────────────────────────────┐                  │
│         │ 👤 John Doe (Admin)          │                   │
│         │ 👤 John Smith (Base)         │ ← Dropdown       │
│         └──────────────────────────────┘                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Interaction States**:

1. **Idle**: Standard textarea, placeholder "Add comment..."
2. **Typing "@"**: Dropdown appears below cursor with user list
3. **Filtering**: User list updates as user types after "@"
4. **Selecting**: Highlighted user can be selected via Enter or click
5. **Mention Inserted**: Text shows "@John Doe" (formatted), dropdown closes
6. **Multiple Mentions**: Process repeats for each "@" typed

**Keyboard Shortcuts**:

- `@` - Trigger mention picker
- `↑/↓` - Navigate user list
- `Enter` - Select highlighted user
- `Escape` - Close mention picker
- `Backspace` - Remove mention if at mention boundary

**Accessibility**:

- ARIA labels for screen readers
- Keyboard-only navigation support
- Focus management (trap focus in dropdown)
- Announce user selection to screen readers

---

### Mention Rendering

**Visual Style**:

- Mentions appear as **blue, bold text** with @ prefix
- Hover state: **underline** + **tooltip** showing user details
- Clickable: Links to user profile or team member page
- Deleted user mentions: **gray text**, not clickable, italic

**Examples**:

**In Comment**:

```
@John Doe please check the calibration date on this equipment.
```

**Rendered**:

```
[[@John Doe]] please check the calibration date on this equipment.
     ↑
  (blue, bold, clickable)
```

**Hover Tooltip**:

```
┌───────────────────────────┐
│ 👤 John Doe               │
│ Admin                     │
│ john.doe@company.com      │
└───────────────────────────┘
```

---

### Bell Icon + Badge Notification

**Visual Design**:

```
Header:
┌──────────────────────────────────────┐
│  [Logo] Assets  Bookings  🔔(3) ⚙️  │  ← Badge shows unread count
└──────────────────────────────────────┘
```

**Dropdown Panel** (when bell clicked):

```
┌─────────────────────────────────────────────────┐
│ Mentions                                         │
├─────────────────────────────────────────────────┤
│ ● John Smith mentioned you                      │
│   "Equipment Booking #123" • 5 min ago          │
│                                                  │
│ ● Sarah Jones mentioned you                     │
│   "Conference Room Booking" • 1 hour ago        │
│                                                  │
│ ○ Mike Lee mentioned you                        │
│   "Office Setup" • Yesterday                    │
│                                                  │
│ [No more mentions]                               │
└─────────────────────────────────────────────────┘

Legend:
● = Unread (blue dot)
○ = Read (no dot)
```

**Behavior**:

- Bell icon permanently visible in header
- Badge shows unread count (1-9, or "9+" for ≥10)
- Click bell → Open dropdown with recent 10-20 mentions
- Click notification → Navigate to booking activity + mark as read
- Badge updates on next page load (not real-time)
- No auto-dismiss - persistent until user clicks
- Dropdown closes when clicking outside or pressing Escape

---

### Email Template

**Subject Line**:

```
[Shelf.nu] John Smith mentioned you in "MacBook Pro 2023"
```

**HTML Body** (simplified wireframe):

```
┌─────────────────────────────────────────────────────────────┐
│  [Shelf.nu Logo]                                             │
│                                                              │
│  Hi Jane,                                                    │
│                                                              │
│  John Smith mentioned you in a comment on MacBook Pro 2023  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ "Hey @Jane Doe, can you confirm this is available     │ │
│  │  for next week's event?"                               │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  [View Activity →]                                           │
│                                                              │
│  ───────────────────────────────────────────────────────    │
│  This is an automated notification from Shelf.nu.           │
│  You received this because you were mentioned.              │
└─────────────────────────────────────────────────────────────┘
```

**Plain Text Version**:

```
Hi Jane,

John Smith mentioned you in a comment on MacBook Pro 2023:

"Hey @Jane Doe, can you confirm this is available for next week's event?"

View the full activity here: https://app.shelf.nu/assets/abc123/activity

---
This is an automated notification from Shelf.nu.
```

---

### Notification Center (Optional)

**Header Icon**:

```
┌──────────────────────────────────────┐
│  [Logo] Assets  Bookings  🔔(3) ⚙️  │  ← Badge shows unread count
└──────────────────────────────────────┘
```

**Dropdown Panel**:

```
┌─────────────────────────────────────────────────┐
│ Mentions                    [Mark all as read]  │
├─────────────────────────────────────────────────┤
│ ● John Smith mentioned you                      │
│   "MacBook Pro 2023" • 5 min ago                │
│                                                  │
│ ● Sarah Jones mentioned you                     │
│   "Conference Room Booking" • 1 hour ago        │
│                                                  │
│ ○ Mike Lee mentioned you                        │
│   "Office Chair #42" • Yesterday                │
│                                                  │
│ [View all mentions →]                           │
└─────────────────────────────────────────────────┘

Legend:
● = Unread (blue dot)
○ = Read (no dot)
```

---

## Integration Points

### 1. Note Service Integration

**File**: `/app/modules/note/service.server.ts`

**Changes Needed**:

- Extract mentions from note content in `createNote()`
- Call `MentionService.createMentions()` after note creation
- Include mention data in note queries for rendering

**Example**:

```typescript
export async function createNote({
  content,
  userId,
  assetId,
  type,
}: CreateNoteParams) {
  // Existing note creation logic...
  const note = await db.note.create({ ... });

  // NEW: Handle mentions if type is COMMENT
  if (type === "COMMENT") {
    const mentions = extractMentionsFromMarkdown(content);
    if (mentions.length > 0) {
      await MentionService.createMentions({
        noteId: note.id,
        mentions,
        mentionerId: userId,
        assetId,
        organizationId,
      });
    }
  }

  return note;
}
```

---

### 2. Markdown Rendering Integration

**File**: `/app/utils/markdoc-wrappers.ts`

**New Function**: `wrapMentionForNote()`

```typescript
export function wrapMentionForNote(userId: string, userName: string): string {
  return `{% mention userId="${userId}" userName="${userName}" /%}`;
}
```

**File**: `/app/components/markdown/markdown-viewer.tsx`

**New Component Registration**:

```typescript
const components = {
  // ... existing components
  Mention: MentionComponent,
};
```

**New Component**: `/app/components/markdown/mention-component.tsx`

```typescript
export function MentionComponent({
  userId,
  userName
}: {
  userId: string;
  userName: string;
}) {
  return (
    <Link
      to={`/settings/team/users/${userId}`}
      className="mention-link"
    >
      @{userName}
    </Link>
  );
}
```

---

### 3. Database Notification Integration

**New File**: `/app/modules/mention/notification.server.ts`

**Functions**:

```typescript
import { db } from "~/database/db.server";

// Create persistent notification record
export async function createMentionNotification({
  bookingNoteMentionId,
  recipientId,
  senderId,
  bookingId,
  organizationId,
}: {
  bookingNoteMentionId: string;
  recipientId: string;
  senderId: string | null;
  bookingId: string;
  organizationId: string;
}) {
  return await db.mentionNotification.create({
    data: {
      bookingNoteMentionId,
      recipientId,
      senderId,
      bookingId,
      organizationId,
      status: "UNREAD",
    },
  });
}

// Get unread count for badge
export async function getUnreadMentionCount(userId: string) {
  return await db.mentionNotification.count({
    where: {
      recipientId: userId,
      status: "UNREAD",
    },
  });
}

// Get recent notifications for dropdown
export async function getUserMentionNotifications(
  userId: string,
  limit: number = 20
) {
  return await db.mentionNotification.findMany({
    where: { recipientId: userId },
    include: {
      sender: {
        select: {
          firstName: true,
          lastName: true,
          profilePicture: true,
        },
      },
      bookingNoteMention: {
        include: {
          bookingNote: {
            select: {
              content: true,
              createdAt: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

// Mark notification as read
export async function markMentionAsRead(notificationId: string) {
  return await db.mentionNotification.update({
    where: { id: notificationId },
    data: {
      status: "READ",
      readAt: new Date(),
    },
  });
}
```

---

### 4. Resend SDK Email Integration

**Install Dependency**:

```bash
npm install resend
```

**Environment Variable**:

```bash
RESEND_API_KEY="re_xxxxxxxxxxxxx"
```

**New File**: `/app/emails/resend.server.ts`

**Resend SDK Wrapper**:

```typescript
import { Resend } from "resend";
import { RESEND_API_KEY, SMTP_FROM } from "~/utils/env";
import { Logger } from "~/utils/logger";

const resend = new Resend(RESEND_API_KEY);

export interface MentionEmailPayload {
  to: string;
  recipientName: string;
  mentionerName: string;
  contextType: "booking";
  contextName: string;
  contextUrl: string;
  commentContent: string;
}

export async function sendMentionEmail(payload: MentionEmailPayload) {
  const {
    to,
    recipientName,
    mentionerName,
    contextName,
    contextUrl,
    commentContent,
  } = payload;

  const subject = `[Shelf.nu] ${mentionerName} mentioned you in "${contextName}"`;

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Hi ${recipientName},</h2>
      <p>${mentionerName} mentioned you in a comment on <strong>${contextName}</strong>:</p>
      <blockquote style="border-left: 3px solid #0066cc; padding-left: 16px; color: #666;">
        ${commentContent}
      </blockquote>
      <p>
        <a href="${contextUrl}" style="background: #0066cc; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
          View Activity
        </a>
      </p>
      <hr style="margin: 32px 0; border: none; border-top: 1px solid #eee;">
      <p style="color: #999; font-size: 12px;">
        This is an automated notification from Shelf.nu.
      </p>
    </div>
  `;

  const text = `
Hi ${recipientName},

${mentionerName} mentioned you in a comment on ${contextName}:

"${commentContent}"

View the full activity here: ${contextUrl}

---
This is an automated notification from Shelf.nu.
  `.trim();

  try {
    const result = await resend.emails.send({
      from: SMTP_FROM || "Shelf.nu <noreply@shelf.nu>",
      to,
      subject,
      html,
      text,
    });

    Logger.info("Mention email sent successfully", {
      to,
      mentionerName,
      contextName,
      resendId: result.data?.id,
    });

    return { success: true, resendId: result.data?.id };
  } catch (cause) {
    Logger.error("Failed to send mention email via Resend", {
      cause,
      to,
      mentionerName,
      contextName,
    });

    return { success: false, error: cause };
  }
}
```

**Why Resend SDK (not Nodemailer/PgBoss)**:

- Direct API call (<1s delivery)
- No PgBoss complexity for Phase 1
- Best-effort delivery (user still gets database notification)
- Built-in analytics via Resend dashboard
- Can add batching in Phase 2 if needed

---

### 5. Permission Integration

**File**: `/app/utils/permissions/permission.data.ts`

**New Permission Entity** (optional, for fine-grained control):

```typescript
export enum PermissionEntity {
  // ... existing entities
  mention = "mention",
}
```

**Permission Checks**:

- Check if user can view asset/booking before showing in mention picker
- Check if mentioned user can access context (warn if not)
- Validate mentioner has permission to comment

---

### 6. CSV Export Integration

**File**: `/app/utils/csv.server.ts`

**Enhancement**: Strip mention markdown to plain text in CSV export

```typescript
// In exportAssetNotesToCsv and exportBookingNotesToCsv
const cleanContent = content
  .replace(/@\[([^\]]+)\]\(mention:\/\/([^\)]+)\)/g, "@$1") // Convert mentions to @Name
  .replace(/\*\*/g, ""); // Remove other markdown
// ... existing cleaning
```

---

## Security & Permissions

### Permission Rules

| User Role    | Can Mention                   | Can Be Mentioned | Can View Mentions                       |
| ------------ | ----------------------------- | ---------------- | --------------------------------------- |
| Owner        | All users in org              | Yes              | All in org                              |
| Admin        | All users in org              | Yes              | All in org                              |
| Base         | All users in org              | Yes              | Only in assets/bookings they can access |
| Self-Service | Users in bookings they create | Yes              | Only in their own bookings              |

### Security Validations

**Server-Side Validations** (All must pass):

1. **Mention Creation**:
   - Mentioner must have permission to comment on asset/booking
   - Mentioned user must exist in database
   - Mentioned user must belong to same organization
   - Mentioned user must not be deleted/disabled
   - Cannot self-mention (optional rule)

2. **Notification Delivery**:
   - Only send to mentioned user (no leaking to others)
   - Validate mentioned user still has access to context
   - Log delivery attempts for audit

3. **Mention Viewing**:
   - User can only see mentions in assets/bookings they can access
   - Deleted users' mentions visible but not actionable
   - API endpoints validate user organization membership

**XSS Prevention**:

- Sanitize all user input before rendering
- Use Markdoc's built-in sanitization
- Escape mention names in markdown
- Validate mention syntax on server

**Injection Prevention**:

- Use parameterized queries for all database operations
- Validate user IDs as valid CUIDs
- Prevent SQL injection in mention queries

---

## Edge Cases & Error Handling

### Edge Cases

| Edge Case                                | Handling Strategy                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| **User deleted after mention**           | Show mention in gray, non-clickable, indicate "[deleted user]"            |
| **Asset/Booking deleted**                | Notification links to 404 page with helpful message                       |
| **Mentioned user loses access**          | Still notify, but show warning in notification: "You may not have access" |
| **Email delivery fails**                 | Log failure, user still gets database notification (email is best-effort) |
| **Duplicate mentions in same comment**   | De-duplicate before creating NoteMention records                          |
| **Mention syntax error**                 | Treat as regular text, don't create mention record                        |
| **Very long comment with many mentions** | Limit to 50 mentions per comment, truncate if exceeded                    |
| **Offline user**                         | Database notification persists, user sees on next login                   |
| **User mentions themselves**             | Allow or block (configurable), no notification sent if allowed            |
| **Rapid mentions (spam)**                | Rate limit: max 100 mentions per user per hour                            |
| **Organization disabled**                | Mentions still rendered, but notifications not sent                       |
| **Badge doesn't update immediately**     | Expected behavior - badge updates on next page load (not real-time)       |
| **Email preferences not set**            | Default to sending email, provide opt-out in future                       |

### Error Messages

**User-Facing Errors**:

- "Unable to mention this user" - User not found or not in organization
- "Mention limit reached" - Too many mentions in single comment
- "You don't have permission to mention users" - Permission issue
- "Failed to send notification" - Generic notification error

**Developer/Log Errors**:

- "Invalid mention syntax: ..." - Parsing error
- "Mention record creation failed: ..." - Database error
- "Email delivery failed for mention: ..." - SMTP error
- "SSE notification failed: ..." - EventEmitter error

---

## Testing Strategy

### Unit Tests

**Services** (`/app/modules/mention/service.server.test.ts`):

- `extractMentionsFromMarkdown()` - Parse various mention formats
- `createMentions()` - Create mention records with valid data
- `getMentionsForUser()` - Query user's mentions with pagination
- `sendMentionNotifications()` - Trigger notification flow

**Utilities** (`/app/utils/mention-helpers.test.ts`):

- Markdown parsing edge cases
- User ID validation
- Duplicate detection

**Mocks**:

```typescript
// why: External email service, no need to test SMTP in unit tests
vi.mock("~/emails/mail.server", () => ({
  sendEmail: vi.fn().mockResolvedValue(true),
}));

// why: EventEmitter is integration point, mock for unit isolation
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn().mockResolvedValue(true),
}));
```

### Integration Tests

**Note Creation with Mentions** (`/app/modules/note/service.server.test.ts`):

- Create note with mentions → verify NoteMention records created
- Create note without mentions → verify no mention records
- Delete note → verify mention records cascade delete

**Permission Validation**:

- Mention user in asset without permission → expect error
- Mention user outside organization → expect error
- Self-service user mentions in others' booking → expect error

**Notification Delivery**:

- Create mention → verify SSE notification sent
- Create mention → verify email queued
- Create mention for offline user → verify notification queued

### End-to-End Tests

**User Flow Tests** (Playwright):

1. Type "@" in comment → verify dropdown appears
2. Filter users → verify list updates
3. Select user → verify mention inserted
4. Submit comment → verify mention rendered
5. Verify mentioned user receives toast notification
6. Verify email sent to mentioned user
7. Click notification → verify navigation to asset

**Cross-Browser Testing**:

- Chrome, Firefox, Safari
- Mobile browsers (iOS Safari, Android Chrome)

### Manual Testing Checklist

- [ ] Mention picker appears on "@"
- [ ] User list filters correctly
- [ ] Keyboard navigation works
- [ ] Mouse selection works
- [ ] Mention renders with correct styling
- [ ] Hover tooltip shows user details
- [ ] Click mention navigates to user profile
- [ ] Toast notification appears for mentioned user
- [ ] Email received by mentioned user
- [ ] Email links work correctly
- [ ] Multiple mentions in same comment work
- [ ] Deleted user mention shows correctly
- [ ] Permission restrictions enforced
- [ ] CSV export includes mentions as plain text
- [ ] Works for both asset and booking comments

---

## Phased Rollout Strategy

### Overview

To ship faster and get user feedback earlier, we recommend a **3-phase incremental rollout** starting with bookings only, then expanding to assets, and finally adding advanced features.

---

### Phase 1: Bookings Only (MVP - Ship First) ⚡

**Goal**: Get @mentions into users' hands ASAP with core functionality on booking comments only.

**Scope**:

- ✅ Mention input component (FR-1) - Bookings only
- ✅ Mention rendering (FR-2) - Bookings only
- ✅ Mention parsing & storage (FR-3) - BookingNoteMention model only
- ✅ In-app toast notifications (FR-4) - Basic implementation
- ✅ Email notifications (FR-5) - Simple template, no batching
- ✅ Basic permissions (FR-7) - Org-level validation only
- ✅ User list API (FR-8.1) - Single endpoint

**Database Changes**:

```prisma
// Add to schema.prisma - BOOKINGS ONLY
model BookingNoteMention {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())

  bookingNoteId   String
  bookingNote     BookingNote @relation(fields: [bookingNoteId], references: [id], onDelete: Cascade)

  mentionedUserId String
  mentionedUser   User   @relation("MentionedInBookingNote", fields: [mentionedUserId], references: [id], onDelete: Cascade)

  mentionerId     String?
  mentioner       User?  @relation("MentionerInBookingNote", fields: [mentionerId], references: [id], onDelete: SetNull)

  bookingId       String
  organizationId  String

  @@unique([bookingNoteId, mentionedUserId])
  @@index([mentionedUserId, createdAt])
  @@index([bookingId])
  @@index([organizationId])
}
```

**Files to Modify**:

1. `/app/modules/booking-note/service.server.ts` - Add mention parsing
2. `/app/components/booking/notes/index.tsx` - Add mention input
3. `/app/utils/markdoc-wrappers.ts` - Add `wrapMentionForNote()`
4. `/app/components/markdown/mention-component.tsx` - New component
5. `/app/emails/mention-notification-template.tsx` - New email template
6. `/app/routes/api+/mentions.users.ts` - New user list endpoint

**Out of Scope for Phase 1**:

- ❌ Asset mentions (comes in Phase 2)
- ❌ Notification center (comes in Phase 3)
- ❌ Email batching (comes in Phase 2)
- ❌ Advanced analytics (comes in Phase 3)
- ❌ Mention notification preferences

**Complexity**: ⚫ **Medium** (5-6 complexity items only)

**Why Bookings First?**:

- Bookings are collaborative by nature (multiple people involved)
- Higher value - custodians, admins, coordinators all need to communicate
- Smaller scope - only one model (BookingNote) vs two (Note + BookingNote)
- Easier to test - more controlled environment

---

### Phase 2: Extend to Assets + Enhancements 🚀

**Goal**: Add mentions to asset comments and improve notification experience.

**Scope**:

- ✅ Asset mention support (FR-1, FR-2, FR-3 for assets)
- ✅ NoteMention model (parallel to BookingNoteMention)
- ✅ Email batching (FR-5.6) - Reduce email spam
- ✅ Improved toast notifications with offline queuing (FR-4.10)
- ✅ Full permission matrix (FR-7) - All role-based rules
- ✅ CSV export support (FR-2.7)
- ✅ Enhanced API endpoints (FR-8.2, FR-8.3)

**Database Changes**:

```prisma
// Add to schema.prisma - ASSETS
model NoteMention {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())

  noteId          String
  note            Note   @relation(fields: [noteId], references: [id], onDelete: Cascade)

  mentionedUserId String
  mentionedUser   User   @relation("MentionedInNote", fields: [mentionedUserId], references: [id], onDelete: Cascade)

  mentionerId     String?
  mentioner       User?  @relation("MentionerInNote", fields: [mentionerId], references: [id], onDelete: SetNull)

  assetId         String
  organizationId  String

  @@unique([noteId, mentionedUserId])
  @@index([mentionedUserId, createdAt])
  @@index([assetId])
  @@index([organizationId])
}
```

**Files to Modify**:

1. `/app/modules/note/service.server.ts` - Add mention parsing (copy from booking-note)
2. `/app/components/assets/notes/index.tsx` - Add mention input (reuse component)
3. `/app/utils/csv.server.ts` - Strip mention markdown
4. `/app/modules/mention/service.server.ts` - Extract shared logic into service
5. Email batching worker (5-min window for duplicate mentions)

**Complexity**: ⚫ **Medium** (mostly copy-paste from Phase 1, plus batching logic)

---

### Phase 3: Advanced Features + Notification Center 🎯

**Goal**: Complete the feature with persistent notifications and advanced capabilities.

**Scope**:

- ✅ Notification Center (FR-6) - Full implementation
- ✅ MentionNotification model
- ✅ Advanced analytics (FR-9)
- ✅ Mention search and filtering
- ✅ User notification preferences
- ✅ Rate limiting (FR-9.7)
- ✅ Enhanced hover tooltips with user cards

**Database Changes**:

```prisma
// Add to schema.prisma - NOTIFICATION CENTER
model MentionNotification {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  recipientId String
  recipient   User   @relation("ReceivedMentions", fields: [recipientId], references: [id], onDelete: Cascade)

  senderId    String?
  sender      User?   @relation("SentMentions", fields: [senderId], references: [id], onDelete: SetNull)

  type        MentionNotificationType
  status      NotificationStatus @default(UNREAD)

  noteMentionId        String?  @unique
  noteMention          NoteMention?  @relation(fields: [noteMentionId], references: [id], onDelete: Cascade)

  bookingNoteMentionId String?  @unique
  bookingNoteMention   BookingNoteMention?  @relation(fields: [bookingNoteMentionId], references: [id], onDelete: Cascade)

  assetId    String?
  bookingId  String?
  readAt     DateTime?

  @@index([recipientId, status, createdAt])
  @@index([recipientId, status])
}
```

**Files to Create**:

1. `/app/components/layout/notification-center/` - Full UI component tree
2. `/app/routes/api+/mentions.notifications.tsx` - Notification CRUD endpoints
3. `/app/modules/mention/analytics.server.ts` - Analytics service
4. `/app/components/user/user-card-popover.tsx` - Enhanced hover card

**Complexity**: ⚫⚫⚫ **High** (new persistent model, complex UI, real-time updates)

---

### Comparison: Full Release vs Phased

| Approach                                | Time to First Ship | User Feedback | Risk   | Learning   |
| --------------------------------------- | ------------------ | ------------- | ------ | ---------- |
| **Full Release** (all features at once) | High               | Late          | High   | Late       |
| **Phase 1** (Bookings only)             | ⚡ Low             | Early         | Low    | Early      |
| **Phase 2** (+ Assets)                  | Medium             | Continuous    | Medium | Continuous |
| **Phase 3** (+ Advanced)                | High               | Informed      | Low    | Validated  |

---

### Phase 1 Implementation Checklist (Ship This First!)

**Backend** (Priority Order):

- [ ] Create Prisma migration for BookingNoteMention model
- [ ] Add `extractMentionsFromMarkdown()` utility function
- [ ] Update `createBookingNote()` to parse and store mentions
- [ ] Create user list API endpoint (`GET /api/mentions/users`)
- [ ] Add mention notification email template (simple version)
- [ ] Wire up SSE notification for mentions
- [ ] Add permission validation (basic org-level check)

**Frontend** (Priority Order):

- [ ] Create mention input component with dropdown
- [ ] Add Markdoc mention tag component
- [ ] Integrate mention input into booking notes textarea
- [ ] Add mention rendering to booking activity feed
- [ ] Wire up toast notifications
- [ ] Add keyboard navigation (arrow keys, enter, escape)

**Testing**:

- [ ] Unit test: `extractMentionsFromMarkdown()`
- [ ] Integration test: Create booking note with mention
- [ ] E2E test: Full mention flow (input → notify → email)
- [ ] Manual test: Booking comment with @mention

**Deployment**:

- [ ] Run migration in staging
- [ ] Feature flag: `ENABLE_BOOKING_MENTIONS` (default: false)
- [ ] Deploy to staging
- [ ] Internal dogfooding (1 week)
- [ ] Enable for all users
- [ ] Monitor notification delivery rates

---

## Technical Risk Mitigation & CTO Concerns

This section addresses potential technical concerns and rejection reasons for Phase 1 rollout.

---

### Concern #1: Email Spam & Deliverability

**Risk**: Sending too many mention emails could get our domain blacklisted or trigger spam filters.

**Phase 1 Mitigation**:

- **No email batching needed in Phase 1** - Each mention = 1 email, simple and predictable
- **Natural rate limiting** - Bookings are inherently low-volume compared to assets
  - Average organization has 10-50 bookings/month vs 1000+ assets
  - Mentions in booking comments are conversational, not automated
- **Email volume is bounded**:
  - Max 1 email per mentioned user per comment
  - Most booking comments have 0-2 mentions (based on similar features in Slack/GitHub)
  - Estimated volume: 50-200 mention emails/month for average org

**Why Phase 2 Needs Batching** (NOT Phase 1):

- Phase 2 adds asset mentions (10x higher volume potential)
- Example: User mentions same person in 5 asset comments in 5 minutes → Without batching = 5 emails → With batching = 1 email
- Phase 1 gives us real data to tune batching window (5 min? 10 min?)

**Built-in Safeguards**:

- PgBoss email queue (already proven in production for booking reminders)
- SMTP rate limiting handled by existing transporter config
- Email retry with exponential backoff (15 retries, 60s delay)
- Feature flag `ENABLE_BOOKING_MENTIONS` allows instant kill switch

**Monitoring Hooks**:

```typescript
// Log all mention email sends for monitoring
logger.info("Mention email sent", {
  recipientId,
  mentionerId,
  bookingId,
  deliveryStatus: "queued" | "sent" | "failed",
});
```

**Rollback Strategy**:

- Disable feature flag → Stops all new mention emails immediately
- Existing emails in PgBoss queue will complete (max 24 hour retention)
- No data loss - mention records remain in database

---

### Concern #2: PgBoss Reliability & Failure Modes

**Risk**: What if PgBoss queue fails? Users won't get notified.

**Phase 1 Reality Check**:

- **PgBoss is already critical infrastructure** in Shelf.nu:
  - Booking checkout reminders (`/app/modules/booking/worker.server.ts:50-80`)
  - Booking checkin reminders (`/app/modules/booking/worker.server.ts:82-120`)
  - Booking overdue handlers (`/app/modules/booking/worker.server.ts:122-160`)
  - Asset reminder emails (`/app/modules/asset-reminder/worker.server.ts`)
  - Email queue worker (`/app/emails/email.worker.server.ts`)
- **If PgBoss fails, booking reminders already fail** - mention emails are not a new risk

**Dual Notification Strategy** (Reduces Risk):

- **In-app toast (SSE)** → Immediate, no PgBoss involved
- **Email (PgBoss)** → Backup, reliable delivery
- If PgBoss is down, users still get toast notifications
- If SSE is disconnected, users still get email

**Failure Mode Analysis**:

| Failure Scenario           | Impact                      | Mitigation                                                                       |
| -------------------------- | --------------------------- | -------------------------------------------------------------------------------- |
| **PgBoss queue full**      | Email delayed               | Queue size: 10,000 jobs (mention emails are tiny payload)                        |
| **PgBoss worker crash**    | Email delayed until restart | Worker auto-restarts via entry.server.tsx registration                           |
| **SMTP server down**       | Email retry                 | 15 retries over 15 hours, then give up gracefully                                |
| **SSE connection dropped** | Toast not shown             | Client auto-reconnects (existing behavior in `/app/components/shared/toast.tsx`) |
| **Database down**          | Nothing works               | Mention emails are least of our problems                                         |

**Observability**:

- PgBoss has built-in monitoring via `pgboss` table
- Track failed jobs: `SELECT * FROM pgboss.job WHERE state = 'failed' AND name = 'email-queue'`
- Alert on mention email failures: `failed_mention_emails > 10/hour`

---

### Concern #3: Database Performance & Load

**Risk**: New tables and queries will slow down the database.

**Phase 1 Database Impact**:

**New Table: `BookingNoteMention`**

- Small footprint: ~10-20 bytes/record (5 indexed fields)
- Estimated volume: 100-500 records/month for average org
- Annual growth: ~6,000 records/org (negligible)

**New Indexes**:

```prisma
@@unique([bookingNoteId, mentionedUserId])  // Prevent duplicates
@@index([mentionedUserId, createdAt])       // User's mention feed
@@index([bookingId])                         // Booking mention queries
@@index([organizationId])                    // Org-level analytics
```

**Query Patterns**:

1. **Write (Insert)**: 1 query per mention on note creation
   - Happens inside existing transaction for `createBookingNote()`
   - No additional round-trips
2. **Read (Select)**: Only when rendering activity feed
   - Already querying BookingNote table - add `include: { mentions: true }`
   - 1 extra JOIN per activity page load (already optimized with pagination)

**Performance Comparison**:

- **Booking reminder worker**: Queries 1000+ bookings every 10 minutes
- **Mention queries**: 1-2 queries per activity page load (user-triggered, not scheduled)
- **Impact**: Negligible - mention queries are 100x less frequent than existing booking queries

**Load Testing Recommendations**:

- Staging test: Create 100 bookings with 5 mentions each → Monitor query time
- Expected: <50ms additional latency on activity feed load
- Baseline: Current activity feed loads in ~200ms

---

### Concern #4: SSE Infrastructure & Scalability

**Risk**: SSE notifications won't work with multiple server instances.

**Phase 1 Reality**:

- **Current deployment**: Single server (Render/Railway/Heroku)
- **SSE already in production**: Used for existing notifications (custody assignments, bulk operations)
- **EventEmitter is in-memory**: Documented limitation in `/app/utils/emitter/emitter.server.ts:5-15`

**Current Code (No Changes Needed for Phase 1)**:

```typescript
// app/utils/emitter/emitter.server.ts
// NOTE: For multi-server deployments, replace with Redis Pub/Sub
export const emitter = new EventEmitter();
```

**Multi-Server Solution** (If needed in future):

- Replace EventEmitter with Redis Pub/Sub
- Use existing Redis infrastructure (if available) or add ioredis
- Example: Supabase Realtime, Pusher, or Ably (all support multi-server)
- **Not needed for Phase 1** - Current deployment is single-server

**Scalability Threshold**:

- Single server handles 10,000+ concurrent SSE connections
- Shelf.nu current scale: ~100-500 concurrent users (estimate)
- Headroom: 20-100x before hitting SSE limits

---

### Concern #5: Feature Flag & Kill Switch

**Risk**: Can't turn off feature quickly if something goes wrong.

**Phase 1 Kill Switch Strategy**:

**Feature Flag** (Environment Variable):

```bash
# .env
ENABLE_BOOKING_MENTIONS=false  # Default: disabled
```

**Kill Switch Levels**:

1. **Level 1: Disable new mentions** (keeps existing mentions visible)

   ```typescript
   // In createBookingNote()
   if (process.env.ENABLE_BOOKING_MENTIONS !== "true") {
     // Skip mention parsing & notification
     return note;
   }
   ```

2. **Level 2: Disable notifications only** (mentions still work, no emails)

   ```typescript
   // In MentionService.sendNotifications()
   if (process.env.ENABLE_MENTION_NOTIFICATIONS !== "true") {
     return; // Skip SSE + email
   }
   ```

3. **Level 3: Hide mentions in UI** (emergency only)
   ```typescript
   // In markdown renderer
   if (process.env.SHOW_MENTIONS !== "true") {
     return <span>@{userName}</span>; // Plain text, no link
   }
   ```

**Rollback Speed**:

- Feature flag change: Instant (no deployment needed)
- Database rollback: Drop `BookingNoteMention` table + remove foreign keys
- Code rollback: Standard git revert + deploy (~5 minutes)

**Monitoring Dashboard** (Recommended):

```
Mention Metrics:
- Mentions created/hour: [graph]
- Email delivery rate: [graph]
- Notification failures: [graph]
- Feature flag status: [ON/OFF toggle]
```

---

### Concern #6: Cost Analysis

**Risk**: Additional infrastructure costs for emails/storage.

**Phase 1 Cost Breakdown**:

**Email Costs** (using typical pricing):

- SMTP providers: $0.001/email (Mailgun, SendGrid, SES)
- Estimated volume: 200 mention emails/month/org
- Cost: $0.20/month/org (negligible)
- 100 orgs: $20/month total

**Database Storage**:

- BookingNoteMention record: ~20 bytes
- 500 mentions/month/org × 12 months = 6,000 records/year
- Storage: 6,000 × 20 bytes = 120KB/org/year
- PostgreSQL: $0.10/GB/month → 120KB = $0.000012/month (essentially free)

**SSE/WebSocket**:

- No additional cost - uses existing HTTP connections
- Bundled in server compute cost

**PgBoss Storage**:

- Email queue records: ~500 bytes each
- Retention: 24 hours, then auto-deleted
- Max storage: 200 jobs/day × 500 bytes = 100KB/day (transient)

**Total Incremental Cost**: ~$20-40/month for 100 organizations (assuming self-hosted email)

**Cost vs Value**:

- Improved collaboration → Fewer missed updates → Less support tickets
- Support ticket cost: $5-20/ticket
- If mentions prevent 5 support tickets/month → $25-100/month saved
- **ROI: Positive from Day 1**

---

### Concern #7: Why Not Wait for Full Feature?

**Risk**: Shipping Phase 1 (bookings only) wastes engineering time if we need to rebuild for Phase 2.

**Counterargument - Why Phased Rollout is Better**:

**Engineering Efficiency**:

- Phase 1 code is ~70% reusable for Phase 2
- Extract mention logic into `/app/modules/mention/service.server.ts` from start
- Phase 2 is copy-paste + batching (2-3 days vs building from scratch)

**User Feedback Loop**:

- Learn mention syntax preferences (current: `@[Name](mention://id)`)
- Learn notification frequency tolerance (do users want emails immediately or batched?)
- Learn UI/UX issues (mention picker positioning, keyboard nav bugs)
- **Avoid building wrong feature at scale** - cheaper to pivot early

**Risk Reduction**:

- If mentions don't get used in bookings → Don't build asset mentions (save 2 weeks)
- If email spam becomes issue → Add batching before expanding (catch early)
- If SSE breaks → Fix in controlled environment (100 users vs 1000 users)

**Market Validation**:

- Bookings are highest-value use case (custodian communication)
- If booking mentions succeed → Strong signal asset mentions will too
- If booking mentions fail → Avoid wasting time on asset mentions

**Competitive Pressure**:

- Get feature to market faster → User delight → Positive reviews
- Competitor launches similar feature → We're already ahead
- Slow shipping = opportunity cost

---

### Concern #8: Support & Maintenance Burden

**Risk**: New feature creates support tickets and maintenance overhead.

**Phase 1 Support Mitigation**:

**Self-Documenting UI**:

- Mention picker shows placeholder text: "Type @ to mention someone"
- Tooltip on hover: "@ mention team members to notify them"
- Empty state: "No users found - check spelling"

**Common User Questions** (Proactive Answers):

1. "How do I mention someone?" → In-app tooltip + Help docs
2. "Why didn't they get notified?" → Check email logs, verify user exists
3. "Can I mention deleted users?" → No, picker excludes them automatically
4. "Can I mention people outside my org?" → No, security restriction

**Error Messages** (User-Friendly):

- "Unable to mention this user" → Clear, actionable
- "Mention limit reached" → Explains 50 mention/comment cap
- "You don't have permission" → Directs to admin

**Admin Tools** (for debugging):

- View all mentions for booking: `GET /api/bookings/:id/mentions`
- Check notification delivery: PgBoss job logs
- Feature flag toggle: `.env` change (no code deploy)

**Documentation Checklist**:

- [ ] User guide: "How to @mention team members"
- [ ] Admin guide: "Troubleshooting mention notifications"
- [ ] Developer docs: "Mentions technical architecture"

**Expected Support Volume**:

- Week 1: 10-20 questions (learning curve)
- Week 2-4: 2-5 questions (post-adoption)
- Ongoing: <1 question/week (self-service via docs)

---

### Concern #9: Migration & Rollback Safety

**Risk**: Database migration fails or causes downtime.

**Phase 1 Migration Strategy**:

**Migration File** (Safe & Reversible):

```sql
-- Up Migration
CREATE TABLE "BookingNoteMention" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "bookingNoteId" TEXT NOT NULL,
  "mentionedUserId" TEXT NOT NULL,
  "mentionerId" TEXT,
  "bookingId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  CONSTRAINT "BookingNoteMention_bookingNoteId_fkey"
    FOREIGN KEY ("bookingNoteId") REFERENCES "BookingNote"("id")
    ON DELETE CASCADE,
  CONSTRAINT "BookingNoteMention_mentionedUserId_fkey"
    FOREIGN KEY ("mentionedUserId") REFERENCES "User"("id")
    ON DELETE CASCADE,
  CONSTRAINT "BookingNoteMention_mentionerId_fkey"
    FOREIGN KEY ("mentionerId") REFERENCES "User"("id")
    ON DELETE SET NULL
);

CREATE UNIQUE INDEX "BookingNoteMention_bookingNoteId_mentionedUserId_key"
  ON "BookingNoteMention"("bookingNoteId", "mentionedUserId");
CREATE INDEX "BookingNoteMention_mentionedUserId_createdAt_idx"
  ON "BookingNoteMention"("mentionedUserId", "createdAt");
CREATE INDEX "BookingNoteMention_bookingId_idx"
  ON "BookingNoteMention"("bookingId");
CREATE INDEX "BookingNoteMention_organizationId_idx"
  ON "BookingNoteMention"("organizationId");

-- Down Migration
DROP TABLE "BookingNoteMention";
```

**Migration Safety Checklist**:

- [x] Uses `ON DELETE CASCADE` → No orphaned records
- [x] Indexes created after table → Fast creation
- [x] No data migration → Zero-downtime
- [x] Reversible → Can rollback cleanly
- [x] No changes to existing tables → No risk to existing data

**Deployment Process**:

1. Deploy code with feature flag OFF
2. Run migration in staging → Verify indexes created
3. Run migration in production → Takes <1 second (empty table)
4. Enable feature flag for internal team only
5. Dogfood for 1 week
6. Enable for all users

**Rollback Process**:

1. Disable feature flag → Stops new mentions
2. Drop table: `DROP TABLE "BookingNoteMention";`
3. Deploy code without mention logic
4. Total rollback time: <5 minutes

---

## Summary of Risk Mitigation

| Risk            | Severity (1-10) | Phase 1 Mitigation                                          | Status        |
| --------------- | --------------- | ----------------------------------------------------------- | ------------- |
| Email spam      | 7               | No batching needed (low volume), PgBoss queue, feature flag | ✅ Mitigated  |
| PgBoss failure  | 6               | Dual notification (SSE + email), already in production      | ✅ Mitigated  |
| Database load   | 4               | Minimal queries, proper indexes, small payload              | ✅ Mitigated  |
| SSE scalability | 5               | Single server (current deployment), 20-100x headroom        | ✅ Acceptable |
| Feature flag    | 2               | Multi-level kill switch, instant disable                    | ✅ Mitigated  |
| Cost            | 2               | ~$20/month for 100 orgs, positive ROI                       | ✅ Acceptable |
| Support burden  | 5               | Self-documenting UI, clear errors, docs                     | ✅ Mitigated  |
| Migration risk  | 3               | Zero-downtime migration, fully reversible                   | ✅ Mitigated  |

**Overall Risk Assessment**: **LOW** ✅

**Recommendation**: **Approve Phase 1 for development and staging deployment.**

---

## Complexity Rankings

Features ranked from **least complex (1)** to **most complex (10)**, based on:

- Technical implementation difficulty
- Number of integration points
- Testing complexity
- Potential for bugs
- Time investment required

| Rank | Feature                              | Complexity       | Phase | Reasoning                                                                          |
| ---- | ------------------------------------ | ---------------- | ----- | ---------------------------------------------------------------------------------- |
| 1    | **FR-2: Mention Rendering**          | ⚪ Low           | 1     | Leverages existing Markdoc infrastructure; add new component and wrapper function  |
| 2    | **FR-8: API Endpoints (User List)**  | ⚪ Low           | 1     | Simple query for users in organization; standard Remix loader                      |
| 3    | **FR-3: Mention Parsing & Storage**  | ⚪⚫ Low-Medium  | 1     | Regex parsing is straightforward; database operations standard                     |
| 4    | **FR-9: Analytics & Audit**          | ⚪⚫ Low-Medium  | 3     | Logging is simple; mostly piggybacking on existing logs                            |
| 5    | **FR-7: User Permissions & Privacy** | ⚫ Medium        | 1-2   | Requires validation at multiple points; permission system already exists           |
| 6    | **FR-1: Mention Input Component**    | ⚫ Medium        | 1     | Complex UI state management; dropdown positioning; keyboard navigation             |
| 7    | **FR-4: In-App Notifications**       | ⚫⚫ Medium-High | 1-2   | SSE infrastructure exists but needs mention-specific logic; handling offline users |
| 8    | **FR-8: API Endpoints (Full Suite)** | ⚫⚫ Medium-High | 2-3   | Multiple endpoints with complex queries; pagination; permission checks             |
| 9    | **FR-5: Email Notifications**        | ⚫⚫ Medium-High | 1-2   | Email template design; batching logic; queue integration; plain text version       |
| 10   | **FR-6: Notification Center**        | ⚫⚫⚫ High      | 3     | New persistent model; complex UI; real-time updates; pagination; filtering         |

### Complexity Legend

- ⚪ Low (1-3): Straightforward implementation, few dependencies
- ⚪⚫ Low-Medium (4): Some complexity but leverages existing patterns
- ⚫ Medium (5-6): Moderate complexity, multiple integration points
- ⚫⚫ Medium-High (7-8): Complex logic, careful testing required
- ⚫⚫⚫ High (9-10): Most complex, significant effort, many edge cases

---

## Success Metrics

### Engagement Metrics

- **Mention Adoption Rate**: % of users who have created at least one mention
- **Mentions per Comment**: Average number of mentions per comment
- **Mention Response Time**: Time between mention and response (comment or action)
- **Active Mentioners**: Daily/weekly active users creating mentions

### Notification Metrics

- **Notification Delivery Rate**: % of mentions successfully notified
- **Email Open Rate**: % of mention emails opened
- **Notification CTR**: % of users clicking through to asset/booking
- **In-App vs Email**: Ratio of in-app views vs email clicks

### Collaboration Metrics

- **Multi-Person Threads**: % of assets/bookings with mentions involving 3+ users
- **Response Rate**: % of mentions that receive a reply
- **Cross-Department Mentions**: Mentions between users of different roles

### Technical Metrics

- **Notification Latency**: Time from mention creation to notification delivery (target: <2 seconds)
- **Email Queue Success Rate**: % of emails delivered successfully
- **API Response Time**: Mention picker API latency (target: <200ms)
- **Error Rate**: Failed mention creations or notifications (target: <1%)

### User Satisfaction

- **Feature Usage Over Time**: Growth in mention usage month-over-month
- **User Feedback**: Survey responses on mention usefulness
- **Support Tickets**: Number of mention-related support requests (lower is better)

---

## Open Questions

### Product Questions

1. **Should users be able to mention non-registered team members (NRMs)?**
   - If yes, how do we notify them? (Email to NRM email address?)
   - If no, how do we indicate NRMs in mention picker?

2. **Should we support @channel or @all mentions to notify entire team?**
   - High notification volume concern
   - Potential for spam
   - Useful for urgent org-wide updates

3. **Should users be able to edit comments with mentions?**
   - How do we handle removed mentions? (Delete NoteMention records?)
   - How do we handle newly added mentions? (Send notifications for edits?)
   - Current system doesn't support editing comments (only deleting)

4. **Should we allow users to opt-out of mention notifications?**
   - Global opt-out or per-context (asset vs booking)?
   - How to handle critical mentions if opted out?
   - Future enhancement to notification preferences

5. **Should we rate-limit mentions to prevent spam?**
   - Per-user limit? (e.g., 100 mentions/hour)
   - Per-comment limit? (e.g., 50 mentions/comment)
   - Organization-level limits?

### Technical Questions

1. **How do we handle mention notifications across multiple servers?**
   - Current EventEmitter is in-memory (single server)
   - Need Redis Pub/Sub for multi-server deployments
   - Document requirement or implement in Phase 1?

2. **Should we implement real-time presence indicators?**
   - Show if mentioned user is online
   - Change notification strategy if user is active
   - Requires WebSocket or SSE connection tracking

3. **How do we handle mention search?**
   - Full-text search across comments with mentions?
   - Filter assets/bookings by "mentions me"?
   - Add to global search?

4. **Should we store rendered mention HTML or render on-the-fly?**
   - Caching strategy for performance
   - Tradeoff: storage vs computation
   - Handle user name changes

5. **How do we handle deleted assets/bookings with mentions?**
   - Keep mention records for audit?
   - Cascade delete or soft delete?
   - Notification history retention

### Design Questions

1. **What's the best visual treatment for mentions?**
   - Blue text vs badge style vs highlight?
   - Should mentions stand out more than regular links?
   - Mobile vs desktop considerations

2. **Where should notification center icon live?**
   - Header nav vs sidebar?
   - Badge placement and style?
   - Mobile responsive design

3. **How do we indicate unread mentions in activity feed?**
   - Blue dot next to comment?
   - Highlight entire comment?
   - Separate "Mentions" tab in activity?

### Privacy & Compliance Questions

1. **Do mentions constitute personal data under GDPR?**
   - Mention records include user relationships
   - Right to erasure implications
   - Data export requirements

2. **Should we log all mention activity for audit?**
   - Compliance requirements
   - Retention policies
   - Access logs for security

---

## Appendix

### Related Documentation

- [Select All Pattern](./select-all-pattern.md) - Pattern for bulk operations
- [Activity Logs Architecture](../app/modules/note/README.md) - Note system overview
- [Notification System](../app/utils/emitter/README.md) - SSE notifications
- [Email System](../app/emails/README.md) - Email infrastructure
- [Permission System](../app/utils/permissions/README.md) - Authorization model

### References

- GitHub Mentions: https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#mentioning-people-and-teams
- Slack Mentions: https://slack.com/help/articles/205240127-Use-mentions-in-Slack
- Markdoc Custom Tags: https://markdoc.dev/docs/tags

### Terminology

- **Mention**: Reference to a user in a comment using @syntax
- **Mentioner**: User who creates the mention
- **Mentioned User**: User who is referenced in the mention
- **NRM**: Non-Registered Member (team member without user account)
- **SSE**: Server-Sent Events (real-time notification delivery)
- **Toast**: Temporary in-app notification popup
- **Markdoc**: Markdown-based content format with custom tags

---

**Document Status**: Ready for Review
**Next Steps**: Review with engineering team, prioritize features, create implementation plan
