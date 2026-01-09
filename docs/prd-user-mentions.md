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

This PRD outlines the implementation of @mentions functionality in Shelf.nu activity logs, enabling users to tag team members in asset and booking comments. When mentioned, users will receive real-time in-app notifications and email alerts, fostering better collaboration and communication around asset management activities.

The feature integrates with Shelf's existing:

- Activity log system (Note and BookingNote models)
- Notification infrastructure (SSE-based toasts and email system)
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
3. Mention analytics or reporting
4. @mentions in system-generated UPDATE notes (only in COMMENT notes)
5. Cross-organization mentions

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

**Description**: Real-time toast notifications when user is mentioned

**Requirements**:

- FR-4.1: Send real-time notification via SSE when user is mentioned
- FR-4.2: Notification shows: mentioner name, asset/booking name, snippet of comment
- FR-4.3: Notification is only sent to mentioned users
- FR-4.4: Notification includes deep link to specific comment
- FR-4.5: Do not send notification to user who authored the mention
- FR-4.6: Support multiple notifications if mentioned in multiple comments
- FR-4.7: Toast notification auto-dismisses after standard timeout (3 seconds)
- FR-4.8: Clicking notification navigates to asset/booking activity tab
- FR-4.9: Show mention icon in toast notification
- FR-4.10: Queue notifications if user is offline (show on next login)

**Dependencies**:

- SSE notification system
- EventEmitter service
- Toast component

---

### FR-5: Email Notifications

**Description**: Email alert when user is mentioned

**Requirements**:

- FR-5.1: Send email to mentioned user's registered email address
- FR-5.2: Email subject: "[Workspace Name] [Mentioner] mentioned you in [Asset/Booking Name]"
- FR-5.3: Email body includes:
  - Who mentioned you
  - Where (asset/booking name with link)
  - Comment content (with mentions highlighted)
  - CTA button to view full context
- FR-5.4: Email includes both HTML and plain text versions
- FR-5.5: Use existing email template design system
- FR-5.6: Batch mentions if same user mentioned multiple times in short period (5 min window)
- FR-5.7: Respect user notification preferences (if they exist)
- FR-5.8: Queue email via PgBoss for reliability
- FR-5.9: Include organization branding in email (if configured)
- FR-5.10: Do not send email if user has viewed the mention in-app within 2 minutes

**Dependencies**:

- Email service
- Email template system
- User preferences (future)
- PgBoss queue

---

### FR-6: Notification Center (Optional Enhancement)

**Description**: Persistent list of mentions and notifications

**Requirements**:

- FR-6.1: Show notification icon in header with unread count badge
- FR-6.2: Dropdown panel shows recent mentions
- FR-6.3: Each notification shows: timestamp, mentioner, context link
- FR-6.4: Mark individual notifications as read
- FR-6.5: "Mark all as read" action
- FR-6.6: Paginated list of all historical mentions
- FR-6.7: Filter by read/unread status
- FR-6.8: Filter by asset vs booking mentions
- FR-6.9: Clear old read notifications after 30 days
- FR-6.10: Real-time updates via SSE

**Dependencies**:

- New Notification model
- Header component
- Notification panel component

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

**Description**: Track mention usage for insights and debugging

**Requirements**:

- FR-9.1: Log all mention creations to system logs
- FR-9.2: Track mention delivery success/failure
- FR-9.3: Track email open rates for mention emails (optional)
- FR-9.4: Track click-through rates on mention notifications
- FR-9.5: Store metadata: mentioner, mentioned user, timestamp, context
- FR-9.6: Admin can view mention activity for their organization
- FR-9.7: Mention counts visible in team member profile (optional)

**Dependencies**:

- Logging infrastructure
- Analytics service (if exists)

---

## Technical Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                         User Interface                           │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────┐ │
│  │ Mention Input    │  │ Mention Renderer │  │ Notification  │ │
│  │ Component        │  │ (Markdoc)        │  │ Center        │ │
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
│  │ (Create/Delete)  │  │ (Parse/Extract)  │  │ Service       │ │
│  └──────────────────┘  └──────────────────┘  └───────────────┘ │
│                              │                                   │
│  ┌──────────────────────────┴────────────────┐                 │
│  │         Mention Event Handler              │                 │
│  └──────────────────────────────────────────┘                  │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌──────────────┐    ┌──────────────┐      ┌──────────────┐
│   Database   │    │ SSE Stream   │      │ Email Queue  │
│  (Prisma)    │    │ (In-App)     │      │  (PgBoss)    │
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
6. Create Note record (content includes mention markdown)
   │
   ▼
7. Create NoteMention records (junction table)
   │
   ▼
8. Trigger mention event → MentionEventHandler
   │
   ├─→ Send SSE notification (real-time)
   │
   └─→ Queue email notification (PgBoss)
   │
   ▼
9. Frontend: Toast notification appears for mentioned users
   │
   ▼
10. Email worker: Send mention email (retry on failure)
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

#### MentionNotification (Optional - for Notification Center)

```prisma
enum MentionNotificationType {
  ASSET_COMMENT
  BOOKING_COMMENT
}

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
  recipient   User   @relation("ReceivedMentions", fields: [recipientId], references: [id], onDelete: Cascade)

  senderId    String?
  sender      User?   @relation("SentMentions", fields: [senderId], references: [id], onDelete: SetNull)

  type        MentionNotificationType
  status      NotificationStatus @default(UNREAD)

  // Context
  noteMentionId        String?  @unique
  noteMention          NoteMention?  @relation(fields: [noteMentionId], references: [id], onDelete: Cascade)

  bookingNoteMentionId String?  @unique
  bookingNoteMention   BookingNoteMention?  @relation(fields: [bookingNoteMentionId], references: [id], onDelete: Cascade)

  // Metadata
  assetId    String?
  bookingId  String?
  readAt     DateTime?

  @@index([recipientId, status, createdAt]) // For notification feed
  @@index([recipientId, status]) // For unread count
}
```

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
  mentionedInNotes        NoteMention[]        @relation("MentionedInNote")
  mentionedInBookingNotes BookingNoteMention[] @relation("MentionedInBookingNote")
  noteMentionsCreated     NoteMention[]        @relation("MentionerInNote")
  bookingMentionsCreated  BookingNoteMention[] @relation("MentionerInBookingNote")

  // Optional: for notification center
  mentionNotificationsReceived MentionNotification[] @relation("ReceivedMentions")
  mentionNotificationsSent     MentionNotification[] @relation("SentMentions")
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

### Toast Notification

**Visual Design**:

```
┌───────────────────────────────────────────────────────────┐
│ 🔔 John Smith mentioned you                               │
│                                                            │
│ In: "MacBook Pro 2023"                                    │
│ "Hey @You, can you confirm this is available?"            │
│                                                            │
│ [View Asset →]                               [Dismiss ×]  │
└───────────────────────────────────────────────────────────┘
```

**Behavior**:

- Appears in top-right corner
- Auto-dismiss after 3 seconds (or existing default)
- Click "View Asset" → Navigate to asset activity tab
- Click "Dismiss" → Close immediately
- Multiple mentions → Stack notifications

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

### 3. SSE Notification Integration

**File**: `/app/utils/emitter/send-notification.server.ts`

**Enhancement**:

```typescript
export async function sendMentionNotification({
  mentionedUserId,
  mentionerName,
  contextType, // "asset" | "booking"
  contextName,
  contextId,
  commentSnippet,
}: MentionNotificationParams) {
  return sendNotification({
    userId: mentionedUserId,
    title: `${mentionerName} mentioned you`,
    message: `In "${contextName}": ${commentSnippet}`,
    icon: { name: "mention", variant: "primary" },
    variant: "primary",
    metadata: {
      type: "mention",
      contextType,
      contextId,
      url: `/${contextType}s/${contextId}/activity`,
    },
  });
}
```

---

### 4. Email Template Integration

**New File**: `/app/emails/mention-notification-template.tsx`

**Template Structure**:

```typescript
import { Html, Text, Link, Container } from "@react-email/components";

interface MentionEmailProps {
  recipientName: string;
  mentionerName: string;
  contextType: "asset" | "booking";
  contextName: string;
  commentContent: string;
  viewUrl: string;
}

export function MentionEmail(props: MentionEmailProps) {
  return (
    <Html>
      <Container>
        <Text>Hi {props.recipientName},</Text>
        <Text>
          {props.mentionerName} mentioned you in a comment on {props.contextName}
        </Text>
        {/* Comment content with mentions highlighted */}
        <Link href={props.viewUrl}>View Activity</Link>
      </Container>
    </Html>
  );
}
```

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

| Edge Case                                | Handling Strategy                                                                |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| **User deleted after mention**           | Show mention in gray, non-clickable, indicate "[deleted user]"                   |
| **Asset/Booking deleted**                | Notification links to 404 page with helpful message                              |
| **Mentioned user loses access**          | Still notify, but show warning in notification: "You may not have access"        |
| **Email delivery fails**                 | Retry via PgBoss queue (15 attempts), log failure, show in-app notification only |
| **Duplicate mentions in same comment**   | De-duplicate before creating NoteMention records                                 |
| **Mention syntax error**                 | Treat as regular text, don't create mention record                               |
| **Very long comment with many mentions** | Limit to 50 mentions per comment, truncate if exceeded                           |
| **Offline user**                         | Queue notification, show on next login                                           |
| **User mentions themselves**             | Allow or block (configurable), no notification sent if allowed                   |
| **Rapid mentions (spam)**                | Rate limit: max 100 mentions per user per hour                                   |
| **Organization disabled**                | Mentions still rendered, but notifications not sent                              |
| **SSE connection dropped**               | Client reconnects automatically, missed notifications shown on reconnect         |
| **Email preferences not set**            | Default to sending email, provide opt-out in future                              |

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

## Complexity Rankings

Features ranked from **least complex (1)** to **most complex (10)**, based on:

- Technical implementation difficulty
- Number of integration points
- Testing complexity
- Potential for bugs
- Time investment required

| Rank | Feature                              | Complexity       | Reasoning                                                                          |
| ---- | ------------------------------------ | ---------------- | ---------------------------------------------------------------------------------- |
| 1    | **FR-2: Mention Rendering**          | ⚪ Low           | Leverages existing Markdoc infrastructure; add new component and wrapper function  |
| 2    | **FR-8: API Endpoints (User List)**  | ⚪ Low           | Simple query for users in organization; standard Remix loader                      |
| 3    | **FR-3: Mention Parsing & Storage**  | ⚪⚫ Low-Medium  | Regex parsing is straightforward; database operations standard                     |
| 4    | **FR-9: Analytics & Audit**          | ⚪⚫ Low-Medium  | Logging is simple; mostly piggybacking on existing logs                            |
| 5    | **FR-7: User Permissions & Privacy** | ⚫ Medium        | Requires validation at multiple points; permission system already exists           |
| 6    | **FR-1: Mention Input Component**    | ⚫ Medium        | Complex UI state management; dropdown positioning; keyboard navigation             |
| 7    | **FR-4: In-App Notifications**       | ⚫⚫ Medium-High | SSE infrastructure exists but needs mention-specific logic; handling offline users |
| 8    | **FR-8: API Endpoints (Full Suite)** | ⚫⚫ Medium-High | Multiple endpoints with complex queries; pagination; permission checks             |
| 9    | **FR-5: Email Notifications**        | ⚫⚫ Medium-High | Email template design; batching logic; queue integration; plain text version       |
| 10   | **FR-6: Notification Center**        | ⚫⚫⚫ High      | New persistent model; complex UI; real-time updates; pagination; filtering         |

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
