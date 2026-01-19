# QA Test Scenarios: Booking Activity Log (Audits)

**Feature**: PR #2037 - Booking Activity Log System
**Purpose**: Track all booking changes and user actions in an immutable audit trail
**Database Model**: `BookingNote` with types `COMMENT` (manual) and `UPDATE` (system-generated)

## Overview

The Booking Activity Log (Audits) feature provides a comprehensive audit trail for all booking operations. It automatically logs system events (status changes, asset additions/removals, check-ins, etc.) and allows users to add manual notes. This feature is critical for compliance, accountability, and troubleshooting.

**Key Files**:

- Service: `app/modules/booking-note/service.server.ts`
- Route: `app/routes/_layout+/bookings.$bookingId.activity.tsx`
- CSV Export: `app/routes/_layout+/bookings.$bookingId.activity[.csv].ts`
- UI: `app/components/booking/notes/`
- Permissions: `app/utils/permissions/permission.data.ts`

---

## Critical Path (P0) - Core Flows That Must Work

### Scenario: View Booking Activity Log

**Priority:** P0
**Preconditions:**

- User is logged in with bookingNote.read permission
- At least one booking exists in the organization
- Booking has at least one activity log entry

**Steps:**

1. Navigate to a booking details page
2. Click on the "Activity" tab
3. Observe the list of activity notes

**Expected:**

- Activity tab loads successfully
- All notes are displayed in reverse chronological order (newest first)
- Each note shows:
  - Content (with markdown rendering)
  - Timestamp
  - User attribution (if manual note) or system icon (if system-generated)
  - Actions dropdown (for user's own notes only)
- System notes (UPDATE type) display without user attribution
- Manual notes (COMMENT type) show user's first and last name

---

### Scenario: Create Manual Booking Note

**Priority:** P0
**Preconditions:**

- User is logged in with bookingNote.create permission
- User has navigated to a booking's Activity tab

**Steps:**

1. Type a note in the "Add note" text area (e.g., "Customer requested early pickup")
2. Click "Add Note" button
3. Observe the note appears in the list

**Expected:**

- Note appears immediately in the list (optimistic UI)
- Note shows user's name as author
- Note is marked as type COMMENT
- Success notification: "Note created - Your note has been created successfully"
- Note persists after page refresh
- Note appears at the top of the list (newest first)

---

### Scenario: Automatic Activity Log - Status Change

**Priority:** P0
**Preconditions:**

- User is logged in as ADMIN or OWNER
- A booking exists in RESERVED status with assets assigned

**Steps:**

1. Navigate to booking details
2. Click "Check out" button to change status from RESERVED to ONGOING
3. Confirm the checkout
4. Navigate to Activity tab

**Expected:**

- System-generated note created with content like:
  - "**[User Name](/settings/account)** checked out the booking. Status changed from **Reserved** to **Ongoing**."
- Note type is UPDATE
- Note has no user attribution (userId is null, displayed as system note)
- Markdown formatting renders correctly (bold text, links)
- Note appears at top of activity list

---

### Scenario: Delete Own Manual Note

**Priority:** P0
**Preconditions:**

- User is logged in with bookingNote.delete permission (ADMIN or OWNER)
- User has created at least one manual note on a booking

**Steps:**

1. Navigate to booking's Activity tab
2. Locate a note created by the current user
3. Click the three-dot actions menu on the note
4. Click "Delete"
5. Confirm deletion in the alert dialog

**Expected:**

- Confirmation dialog appears: "Are you sure you want to delete this note?"
- After confirming, note is removed from the list
- Success notification: "Note deleted - Your note has been deleted successfully"
- Note does not reappear after page refresh
- Other notes remain intact

---

### Scenario: Export Activity Log to CSV

**Priority:** P0
**Preconditions:**

- User has bookingNote.read permission
- Booking has at least 5 activity notes (mix of manual and system)

**Steps:**

1. Navigate to booking's Activity tab
2. Click "Export activity CSV" button (top right)
3. Check downloaded file

**Expected:**

- CSV file downloads immediately
- Filename format: `{booking-name}-activity-{timestamp}.csv`
- CSV contains columns: Date, Type, Content, Author
- All notes are included (both COMMENT and UPDATE types)
- Markdown is preserved in content field
- System notes show empty/null author
- Manual notes show user's full name as author
- Dates are formatted correctly
- Special characters in booking name are sanitized (no `/\:*?"<>|`)

---

## Edge Cases (P1) - Boundaries, Empty States, Limits

### Scenario: View Activity Log with No Notes

**Priority:** P1
**Preconditions:**

- User has bookingNote.read permission
- A booking exists with zero activity notes

**Steps:**

1. Navigate to booking's Activity tab

**Expected:**

- Empty state UI displays:
  - Image: `/static/images/no-notes.svg`
  - Heading: "No Notes"
  - Message: "Your booking `{booking-name}` has no notes attached to it."
- "Export activity CSV" button is hidden
- Note creation form is still visible and functional

---

### Scenario: Create Note with Maximum Length Content

**Priority:** P1
**Preconditions:**

- User has bookingNote.create permission

**Steps:**

1. Navigate to booking's Activity tab
2. Paste a very long text (10,000+ characters) into note field
3. Submit the note

**Expected:**

- Note is created successfully (or validation error if there's a limit)
- If created, full content is stored and displayed
- UI handles long content gracefully (scrolling, text wrapping)
- CSV export includes full content without truncation

---

### Scenario: Create Note with Markdown Formatting

**Priority:** P1
**Preconditions:**

- User has bookingNote.create permission

**Steps:**

1. Navigate to booking's Activity tab
2. Enter a note with markdown: "## Heading\n**Bold text** and _italic_ with [link](https://example.com)"
3. Submit the note

**Expected:**

- Note is stored with raw markdown
- UI renders markdown correctly:
  - Heading displays as larger text
  - Bold text is bold
  - Italic text is italicized
  - Link is clickable
- CSV export contains raw markdown (not rendered HTML)

---

### Scenario: Create Note with Special Characters

**Priority:** P1
**Preconditions:**

- User has bookingNote.create permission

**Steps:**

1. Create a note with special characters: `"Test <script>alert('xss')</script> & "quotes" 'apostrophes'"`
2. Submit the note

**Expected:**

- Note is created successfully
- Special characters are properly escaped/sanitized
- No XSS vulnerability (script tags don't execute)
- Characters display correctly in UI
- CSV export handles special characters properly

---

### Scenario: Rapid Sequential Note Creation

**Priority:** P1
**Preconditions:**

- User has bookingNote.create permission

**Steps:**

1. Navigate to booking's Activity tab
2. Quickly create 5 notes in succession (within 10 seconds)
3. Observe the notes list

**Expected:**

- All 5 notes are created successfully
- No race conditions or duplicate notes
- Optimistic UI handles rapid submissions gracefully
- All notes appear in correct chronological order
- No errors or timeouts

---

### Scenario: Activity Log for Booking with 100+ Activities

**Priority:** P1
**Preconditions:**

- A booking has 100+ activity notes (system + manual)

**Steps:**

1. Navigate to booking's Activity tab
2. Scroll through the activity list
3. Export to CSV

**Expected:**

- Page loads without performance issues
- All notes are fetched and displayed
- Scrolling is smooth (consider pagination/infinite scroll if implemented)
- CSV export includes all 100+ notes
- No timeout errors

---

### Scenario: CSV Export with Empty Booking Name

**Priority:** P1
**Preconditions:**

- A booking exists with empty/whitespace-only name
- Booking has activity notes

**Steps:**

1. Navigate to booking's Activity tab
2. Click "Export activity CSV"

**Expected:**

- CSV downloads successfully
- Filename falls back to: `booking-activity-{timestamp}.csv`
- File contains all activity data

---

### Scenario: Attempt to Delete System-Generated Note

**Priority:** P1
**Preconditions:**

- User is ADMIN or OWNER
- Booking has system-generated notes (UPDATE type)

**Steps:**

1. Navigate to booking's Activity tab
2. Locate a system-generated note (no user attribution)
3. Look for actions dropdown

**Expected:**

- System notes do not have an actions dropdown
- No way to delete system-generated notes via UI
- If attempted via API (e.g., direct request), operation fails (userId filter prevents deletion)

---

### Scenario: View Activity After Booking Creator Deleted

**Priority:** P1
**Preconditions:**

- Booking has activity notes created by User A
- User A's account is deleted (soft deleted with deletedAt timestamp)

**Steps:**

1. Navigate to booking's Activity tab
2. Review notes created by deleted user

**Expected:**

- Notes remain visible
- Notes show null/empty user attribution (due to onDelete: SetNull)
- No errors or broken references
- Activity log maintains data integrity

---

## Error Handling (P1) - Failure Scenarios

### Scenario: Access Activity Tab Without Permission

**Priority:** P1
**Preconditions:**

- User is logged in as SELF_SERVICE or BASE (without bookingNote.read if removed)
- Or user is not a member of the organization

**Steps:**

1. Attempt to navigate to `/bookings/{bookingId}/activity`

**Expected:**

- If no bookingNote.read permission:
  - Display: "Insufficient permissions" message
  - Icon: NoPermissionsIcon
  - Message: "You are not allowed to view booking notes"
- If booking doesn't belong to user's organization:
  - 404 error or access denied
  - Appropriate error message

---

### Scenario: Create Note Without Permission

**Priority:** P1
**Preconditions:**

- User has bookingNote.read but NOT bookingNote.create
- (Note: Currently BASE and SELF_SERVICE have both read and create)

**Steps:**

1. Navigate to booking's Activity tab
2. Attempt to create a note

**Expected:**

- Note creation form may be disabled/hidden
- If attempted via API, returns 403 Forbidden
- Appropriate error message

---

### Scenario: Delete Another User's Note

**Priority:** P1
**Preconditions:**

- User A creates a manual note on a booking
- User B is ADMIN in the same organization

**Steps:**

1. Login as User B
2. Navigate to the booking's Activity tab
3. Look for actions dropdown on User A's note

**Expected:**

- User B can see User A's note
- Actions dropdown is NOT visible on User A's note (only on own notes)
- If delete attempted via API with User B's credentials, operation fails
- deleteBookingNote uses userId filter, so deleteMany returns 0 rows affected

---

### Scenario: Network Failure During Note Creation

**Priority:** P1
**Preconditions:**

- User has bookingNote.create permission

**Steps:**

1. Navigate to booking's Activity tab
2. Disconnect network or use browser dev tools to simulate offline
3. Type a note and click "Add Note"
4. Reconnect network

**Expected:**

- Optimistic UI shows the note immediately
- After network failure is detected, note should be marked as failed or removed
- User sees error notification
- Form retains the note content for retry
- After reconnecting, user can retry submission

---

### Scenario: Database Error During Activity Log Creation

**Priority:** P1
**Preconditions:**

- Simulate database connection issue

**Steps:**

1. Trigger a booking operation that creates system notes (e.g., status change)
2. Database throws an error during note creation

**Expected:**

- Main booking operation should complete (or fail gracefully)
- Error is logged to error tracking system (Sentry/etc.)
- ShelfError thrown with appropriate context
- User sees generic error message (not raw database error)
- System remains stable

---

### Scenario: Invalid Booking ID for Activity Tab

**Priority:** P1
**Preconditions:**

- User is logged in

**Steps:**

1. Navigate to `/bookings/invalid-id-12345/activity`

**Expected:**

- Returns 404 Not Found or similar error
- Error message: "Booking not found or access denied"
- ErrorBoundary component renders ErrorContent
- No application crash

---

### Scenario: Concurrent Note Deletions

**Priority:** P1
**Preconditions:**

- User has 2 browser tabs open on same booking activity tab
- User has created a note

**Steps:**

1. In Tab 1, click delete on the note
2. Simultaneously in Tab 2, click delete on the same note
3. Confirm both deletions

**Expected:**

- One deletion succeeds (first one processed)
- Second deletion fails gracefully (note already deleted)
- No application error
- Both tabs update to reflect note is gone (after refresh or re-fetch)

---

### Scenario: CSV Export Timeout for Large Dataset

**Priority:** P1
**Preconditions:**

- Booking has thousands of activity notes

**Steps:**

1. Click "Export activity CSV"
2. Wait for download

**Expected:**

- Export completes within reasonable time (< 30 seconds for 10k notes)
- If timeout occurs, user sees appropriate error message
- No server crash or memory issues
- Consider streaming/chunking for very large exports

---

## Permissions (P0) - Role-Based Access Control

### Scenario: SELF_SERVICE User Permissions

**Priority:** P0
**Preconditions:**

- User has SELF_SERVICE role in organization
- Booking exists in the organization

**Steps:**

1. Login as SELF_SERVICE user
2. Navigate to booking's Activity tab
3. Attempt to:
   - View activity notes
   - Create a manual note
   - Delete own manual note
   - Export to CSV

**Expected:**

- ✅ Can view activity notes (bookingNote.read)
- ✅ Can create manual notes (bookingNote.create)
- ❌ Cannot delete notes (no bookingNote.delete permission)
  - Actions dropdown not visible on any notes
- ✅ Can export CSV (requires only bookingNote.read)

---

### Scenario: BASE User Permissions

**Priority:** P0
**Preconditions:**

- User has BASE role in organization

**Steps:**

1. Login as BASE user
2. Test same actions as SELF_SERVICE scenario

**Expected:**

- Same permissions as SELF_SERVICE:
- ✅ Can read
- ✅ Can create
- ❌ Cannot delete
- ✅ Can export CSV

---

### Scenario: ADMIN User Permissions

**Priority:** P0
**Preconditions:**

- User has ADMIN role in organization

**Steps:**

1. Login as ADMIN user
2. Test all bookingNote actions

**Expected:**

- ✅ Can read (bookingNote.read)
- ✅ Can create (bookingNote.create)
- ✅ Can update (bookingNote.update) - if implemented
- ✅ Can delete OWN manual notes (bookingNote.delete)
- ❌ Cannot delete OTHER users' notes
- ❌ Cannot delete system notes
- ✅ Can export CSV

---

### Scenario: OWNER User Permissions

**Priority:** P0
**Preconditions:**

- User is the organization OWNER

**Steps:**

1. Login as OWNER
2. Test all bookingNote actions

**Expected:**

- Same full permissions as ADMIN:
- ✅ All read, create, update, delete permissions
- Can only delete own manual notes
- Cannot delete system notes

---

### Scenario: Cross-Organization Access Attempt

**Priority:** P0
**Preconditions:**

- User is ADMIN in Organization A
- Booking exists in Organization B

**Steps:**

1. Login as ADMIN of Org A
2. Attempt to access `/bookings/{org-b-booking-id}/activity`

**Expected:**

- Access denied (404 or 403)
- Error message: "Booking not found or access denied"
- getBookingNotes validates organizationId matches booking
- No data leak across organizations

---

### Scenario: Permission Validation on Every Request

**Priority:** P0
**Preconditions:**

- User is logged in

**Steps:**

1. Inspect network requests when:
   - Loading activity tab
   - Creating a note
   - Deleting a note
   - Exporting CSV

**Expected:**

- Every request calls `requirePermission()` with appropriate entity and action
- Activity tab loader: requires bookingNote.read
- Create note action: requires bookingNote.create
- Delete note action: requires bookingNote.delete (via own user ID check)
- CSV export: requires both booking.read and bookingNote.read

---

## Data Integrity (P1) - Persistence, Sync, State Management

### Scenario: Note Persistence Across Sessions

**Priority:** P1
**Preconditions:**

- User creates manual notes on a booking

**Steps:**

1. Create 3 manual notes
2. Logout
3. Login again
4. Navigate to booking's Activity tab

**Expected:**

- All 3 notes are still present
- Notes display in correct order
- Timestamps are accurate
- User attribution is correct

---

### Scenario: Optimistic UI Rollback on Failure

**Priority:** P1
**Preconditions:**

- User has bookingNote.create permission
- Simulate server error during creation

**Steps:**

1. Navigate to booking's Activity tab
2. Create a note
3. Server returns error (e.g., 500)

**Expected:**

- Note appears immediately (optimistic UI)
- After error response, optimistic note is removed or marked as failed
- Error notification is shown
- Note text is preserved in form for retry

---

### Scenario: System Note Generation During Bulk Operations

**Priority:** P1
**Preconditions:**

- User performs bulk asset addition to booking

**Steps:**

1. Add 20 assets to a booking at once
2. Navigate to Activity tab

**Expected:**

- Single system note created (not 20 separate notes)
- Note content: "**[User Name](/settings/account)** added **20 assets** to the booking."
- Assets listed or summarized appropriately in note
- Note created atomically with the operation

---

### Scenario: Activity Log Integrity After Asset Deletion

**Priority:** P1
**Preconditions:**

- Booking has activity notes referencing specific assets
- Assets are later deleted from system

**Steps:**

1. Add Asset "Laptop-123" to booking (creates system note)
2. Note content includes asset title
3. Delete Asset "Laptop-123" permanently
4. View booking's Activity tab

**Expected:**

- Activity note remains intact
- Asset title in note is preserved (stored as text, not reference)
- Links to deleted assets may be broken (acceptable)
- No cascade deletion of activity notes

---

### Scenario: Concurrent Activity Log Creation

**Priority:** P1
**Preconditions:**

- Two users modifying same booking simultaneously

**Steps:**

1. User A checks out booking (creates system note)
2. Simultaneously, User B adds a manual note
3. Both actions happen within same second

**Expected:**

- Both notes are created successfully
- No race conditions or lost updates
- Notes appear in correct chronological order
- Timestamps are accurate (microsecond precision if needed)

---

### Scenario: Activity Log Order with Clock Skew

**Priority:** P1
**Preconditions:**

- Server clock and database clock may have minor differences

**Steps:**

1. Create several notes in rapid succession
2. Check note ordering

**Expected:**

- Notes are ordered by createdAt DESC
- Order is consistent and stable
- No notes appear out of order due to timestamp issues
- Database timestamps (not application server time) should be used

---

## Integrations (P1) - How It Connects to Existing Features

### Scenario: Activity Log for Booking Status Transitions

**Priority:** P1
**Preconditions:**

- Booking exists in DRAFT status

**Steps:**

1. Change booking through all statuses:
   - DRAFT → RESERVED
   - RESERVED → ONGOING
   - ONGOING → COMPLETE
   - COMPLETE → ARCHIVED
2. Check Activity tab after each transition

**Expected:**

- System note created for each status change
- Note format: "{UserLink} changed booking status from **{OldStatus}** to **{NewStatus}**."
- Status badges rendered with proper formatting
- Cancellation also creates activity note

---

### Scenario: Activity Log for Asset Addition

**Priority:** P1
**Preconditions:**

- Booking exists with 0 assets

**Steps:**

1. Add 3 standalone assets to booking
2. Check Activity tab

**Expected:**

- System note created: "{UserLink} added **3 assets** (Asset 1, Asset 2, Asset 3) to booking."
- Asset titles are listed in note
- Note created immediately after operation completes

---

### Scenario: Activity Log for Kit Addition

**Priority:** P1
**Preconditions:**

- Booking exists
- Kit with 5 assets exists

**Steps:**

1. Add kit to booking
2. Check Activity tab

**Expected:**

- System note: "{UserLink} added **1 kit** (Kit Name) to booking."
- If kit + standalone assets added together:
  - "{UserLink} added **1 kit** (Kit Name) and **X assets** (Asset1, Asset2) to booking."

---

### Scenario: Activity Log for Asset/Kit Removal

**Priority:** P1
**Preconditions:**

- Booking has assets and kits

**Steps:**

1. Remove 2 assets from booking
2. Remove 1 kit from booking
3. Check Activity tab

**Expected:**

- System note for asset removal: "{UserLink} removed **2 assets** (Asset1, Asset2) from booking."
- System note for kit removal: "{UserLink} removed **1 kit** (Kit Name) from booking."
- If both removed together:
  - "{UserLink} removed **1 kit** (Kit Name) and **2 assets** (Asset1, Asset2) from booking."

---

### Scenario: Activity Log for Partial Check-In

**Priority:** P1
**Preconditions:**

- Booking with 10 assets in ONGOING status

**Steps:**

1. Perform partial check-in of 4 assets
2. Check Activity tab
3. Perform second partial check-in of 6 assets (completing booking)
4. Check Activity tab again

**Expected:**

- First check-in note: "{UserLink} performed a partial check-in: **4 assets** (Asset1, Asset2, Asset3, Asset4). (Remaining: 6)."
- Second check-in note: "{UserLink} performed a partial check-in: **6 assets** (...) and completed the booking. Status changed from **Ongoing** to **Complete**."

---

### Scenario: Activity Log for Booking Extension

**Priority:** P1
**Preconditions:**

- Booking exists with end date set to 7 days from now

**Steps:**

1. Extend booking end date by 3 days
2. Check Activity tab

**Expected:**

- System note: "{UserLink} extended the booking from **{OldDate}** to **{NewDate}**."
- Dates formatted as markdown and human-readable

---

### Scenario: Activity Log for Booking Detail Changes

**Priority:** P1
**Preconditions:**

- Booking exists with name, description, start/end dates, custodian

**Steps:**

1. Change booking name from "Q1 Equipment" to "Q2 Equipment"
2. Update description from "Old" to "New"
3. Change start date
4. Change end date
5. Change custodian from User A to User B
6. Check Activity tab after each change

**Expected:**

- Name change: "{UserLink} changed booking name from **Q1 Equipment** to **Q2 Equipment**."
- Description change: "{UserLink} changed booking description from **Old** to **New**."
- Start date change: "{UserLink} changed booking start date from **{OldDate}** to **{NewDate}**."
- End date change: "{UserLink} changed booking end date from **{OldDate}** to **{NewDate}**."
- Custodian change: "{UserLink} changed booking custodian from **User A** to **User B**." (or similar)

---

### Scenario: Activity Log for Tag Changes

**Priority:** P1
**Preconditions:**

- Booking has tags: "Priority", "Equipment"

**Steps:**

1. Change tags to: "Priority", "Urgent"
2. Check Activity tab

**Expected:**

- System note: "{UserLink} changed booking tags from **Priority, Equipment** to **Priority, Urgent**."

---

### Scenario: Full Booking Check-Out Creates Activity Log

**Priority:** P1
**Preconditions:**

- Booking in RESERVED status with assets

**Steps:**

1. Check out the entire booking
2. Navigate to Activity tab

**Expected:**

- System note created: "{UserLink} checked out the booking. Status changed from **Reserved** to **Ongoing**."

---

### Scenario: Full Booking Check-In Creates Activity Log

**Priority:** P1
**Preconditions:**

- Booking in ONGOING status

**Steps:**

1. Check in the entire booking
2. Navigate to Activity tab

**Expected:**

- System note created: "{UserLink} checked in the booking. Status changed from **Ongoing** to **Complete**."

---

### Scenario: Activity Log Links to User Profile

**Priority:** P1
**Preconditions:**

- System notes reference users

**Steps:**

1. View a system note with user link
2. Click on the user link in the note (e.g., **[User Name](/settings/account)**)

**Expected:**

- Link navigates to user profile/account page
- Link format is markdown: `**[FirstName LastName](/settings/account)**`
- Links render as clickable, open in same or new tab appropriately

---

### Scenario: Activity Log Preserves Booking Context

**Priority:** P1
**Preconditions:**

- Booking is renamed or modified heavily after activity notes created

**Steps:**

1. Create booking "Q1 Rental"
2. Add assets (creates activity notes)
3. Rename booking to "Q2 Rental"
4. View Activity tab

**Expected:**

- Activity notes are still associated with booking
- Notes reference old booking name at time of action (if stored)
- No orphaned or lost activity notes

---

## Email/Notifications (P2) - All Triggered Communications

### Scenario: In-App Notification on Note Creation

**Priority:** P2
**Preconditions:**

- User creates a manual note

**Steps:**

1. Submit a new note
2. Observe notification

**Expected:**

- Toast notification appears:
  - Title: "Note created"
  - Message: "Your note has been created successfully"
  - Icon: Success checkmark
  - Variant: Success (green)
- Notification auto-dismisses after 3-5 seconds
- Notification sent via `sendNotification()` to current user only

---

### Scenario: In-App Notification on Note Deletion

**Priority:** P2
**Preconditions:**

- User deletes their own note

**Steps:**

1. Delete a note
2. Observe notification

**Expected:**

- Toast notification appears:
  - Title: "Note deleted"
  - Message: "Your note has been deleted successfully"
  - Icon: Success checkmark
  - Variant: Success (green)
- Notification auto-dismisses after 3-5 seconds

---

### Scenario: No Email Notifications for Activity Logs

**Priority:** P2
**Preconditions:**

- Various booking operations performed

**Steps:**

1. Create notes, perform check-ins, change statuses
2. Check email inbox for all organization members

**Expected:**

- No emails sent for activity log events
- Activity logs are internal audit trail only (not email notifications)
- This is expected behavior (not a bug)

---

## Regression Risks (P1) - What Existing Features Might Break

### Scenario: Booking CRUD Operations Still Work

**Priority:** P1
**Preconditions:**

- Activity log feature is enabled

**Steps:**

1. Create a new booking
2. Update booking details
3. Delete a booking
4. Verify no errors

**Expected:**

- All booking operations complete successfully
- Activity notes are created for applicable operations
- If activity log creation fails, booking operations should still complete (graceful degradation)
- No breaking changes to booking service

---

### Scenario: Booking List Performance Not Degraded

**Priority:** P1
**Preconditions:**

- Organization has 100+ bookings

**Steps:**

1. Navigate to bookings list page
2. Measure load time

**Expected:**

- Bookings list loads without fetching activity notes (lazy loading)
- No N+1 query issues from activity log feature
- Page performance is same as before feature

---

### Scenario: Booking Details Page Performance

**Priority:** P1
**Preconditions:**

- Booking has many activity notes

**Steps:**

1. Navigate to booking details page (Overview tab, not Activity tab)
2. Measure load time

**Expected:**

- Activity notes are NOT loaded on Overview tab (only on Activity tab)
- Page loads quickly
- Activity data fetched only when Activity tab is clicked

---

### Scenario: Booking Export (PDF/CSV) Still Works

**Priority:** P1
**Preconditions:**

- Booking has activity notes

**Steps:**

1. Export booking to PDF
2. Export bookings to CSV (main bookings export, not activity export)

**Expected:**

- Booking exports work as before
- Activity notes are NOT included in main booking exports
- Separate activity CSV export is available via Activity tab

---

### Scenario: Booking Deletion Cascades to Activity Notes

**Priority:** P1
**Preconditions:**

- Booking has 10+ activity notes (mix of manual and system)

**Steps:**

1. Delete the booking
2. Query database for booking notes

**Expected:**

- Booking is deleted
- All associated BookingNotes are cascade deleted (onDelete: Cascade)
- No orphaned activity notes remain
- No foreign key constraint errors

---

### Scenario: Asset Notes Feature Unaffected

**Priority:** P1
**Preconditions:**

- Assets have notes (using Note model)

**Steps:**

1. View asset notes
2. Create/delete asset notes
3. Verify functionality

**Expected:**

- Asset notes feature works independently
- No confusion between BookingNote and Note models
- Similar UI patterns but separate data models

---

### Scenario: Booking Calendar View Unaffected

**Priority:** P1
**Preconditions:**

- Multiple bookings exist

**Steps:**

1. Navigate to bookings calendar view
2. Verify bookings display correctly

**Expected:**

- Calendar view loads successfully
- Activity notes do not affect calendar rendering
- No performance degradation

---

### Scenario: Booking Conflict Detection Unaffected

**Priority:** P1
**Preconditions:**

- Two overlapping bookings for same asset

**Steps:**

1. Attempt to create conflicting booking
2. Verify conflict detection works

**Expected:**

- Conflict detection still works correctly
- Activity log feature doesn't interfere with validation
- Appropriate error messages shown

---

### Scenario: Database Migration Completed Successfully

**Priority:** P1
**Preconditions:**

- Fresh installation or migration from pre-audits version

**Steps:**

1. Run database migrations
2. Check BookingNote table exists
3. Verify schema matches expected structure

**Expected:**

- `BookingNote` table created with columns:
  - id, content, type, bookingId, userId, createdAt, updatedAt
- Indexes created on bookingId and userId
- Foreign key constraints set up correctly (onDelete: Cascade for booking, SetNull for user)
- No migration errors

---

### Scenario: Existing Bookings Handle Activity Log Gracefully

**Priority:** P1
**Preconditions:**

- Bookings existed before activity log feature deployed

**Steps:**

1. Access pre-existing booking's Activity tab
2. Perform operations on old booking (add asset, change status)

**Expected:**

- Activity tab loads with empty state (no historical notes)
- New operations create activity notes going forward
- No errors for bookings with no historical activity
- Feature works seamlessly with pre-existing data

---

### Scenario: Search/Filter Bookings Unaffected

**Priority:** P1
**Preconditions:**

- Bookings have activity notes

**Steps:**

1. Use booking search functionality
2. Apply filters to bookings list

**Expected:**

- Search/filter works as before
- Activity notes do not interfere with search indexing
- Search does NOT search within activity notes (unless explicitly designed to)

---

## Minimum Viable Test Coverage

**Before merging this feature, the following scenarios MUST pass:**

### P0 - Must Pass (11 scenarios)

1. ✅ View Booking Activity Log
2. ✅ Create Manual Booking Note
3. ✅ Automatic Activity Log - Status Change
4. ✅ Delete Own Manual Note
5. ✅ Export Activity Log to CSV
6. ✅ SELF_SERVICE User Permissions
7. ✅ BASE User Permissions
8. ✅ ADMIN User Permissions
9. ✅ OWNER User Permissions
10. ✅ Cross-Organization Access Attempt
11. ✅ Permission Validation on Every Request

### Critical Regressions (5 scenarios)

1. ✅ Booking CRUD Operations Still Work
2. ✅ Booking List Performance Not Degraded
3. ✅ Booking Deletion Cascades to Activity Notes
4. ✅ Database Migration Completed Successfully
5. ✅ Existing Bookings Handle Activity Log Gracefully

### Key Integration Points (3 scenarios)

1. ✅ Activity Log for Booking Status Transitions
2. ✅ Activity Log for Asset Addition
3. ✅ Activity Log for Partial Check-In

**Total P0 Scenarios: 19**

---

## Recommended Test Order

**Phase 1: Foundation (Day 1)**

1. Database Migration Completed Successfully
2. View Booking Activity Log (empty state and with data)
3. Permission Validation on Every Request (all roles)
4. Cross-Organization Access Attempt

**Phase 2: Core Functionality (Day 1-2)** 5. Create Manual Booking Note 6. Delete Own Manual Note 7. Delete Another User's Note (negative test) 8. Export Activity Log to CSV 9. View Activity Log with No Notes (empty state)

**Phase 3: System Activity Logging (Day 2)** 10. Automatic Activity Log - Status Change 11. Activity Log for Asset Addition/Removal 12. Activity Log for Kit Addition/Removal 13. Activity Log for Partial Check-In 14. Activity Log for Booking Detail Changes (name, dates, custodian, tags) 15. Activity Log for Booking Extension

**Phase 4: Edge Cases (Day 3)** 16. Create Note with Markdown Formatting 17. Create Note with Special Characters 18. Rapid Sequential Note Creation 19. Activity Log for Booking with 100+ Activities 20. CSV Export with Empty Booking Name 21. Attempt to Delete System-Generated Note

**Phase 5: Permissions Deep Dive (Day 3)** 22. SELF_SERVICE User Permissions (full test) 23. BASE User Permissions (full test) 24. ADMIN User Permissions (full test) 25. OWNER User Permissions (full test) 26. Access Activity Tab Without Permission

**Phase 6: Error Handling (Day 4)** 27. Network Failure During Note Creation 28. Invalid Booking ID for Activity Tab 29. Concurrent Note Deletions 30. Database Error During Activity Log Creation

**Phase 7: Regression Testing (Day 4)** 31. Booking CRUD Operations Still Work 32. Booking List Performance Not Degraded 33. Booking Details Page Performance 34. Booking Deletion Cascades to Activity Notes 35. Asset Notes Feature Unaffected 36. Existing Bookings Handle Activity Log Gracefully 37. Search/Filter Bookings Unaffected

**Phase 8: Data Integrity (Day 5)** 38. Note Persistence Across Sessions 39. System Note Generation During Bulk Operations 40. Activity Log Integrity After Asset Deletion 41. Concurrent Activity Log Creation 42. Activity Log Links to User Profile

**Phase 9: Polish & Notifications (Day 5)** 43. In-App Notification on Note Creation 44. In-App Notification on Note Deletion 45. Optimistic UI Rollback on Failure

---

## Test Data Setup Requirements

### Organizations

- Org A (main testing): TEAM type with SSO disabled
- Org B (cross-org testing): TEAM type

### Users

- User 1: OWNER role in Org A
- User 2: ADMIN role in Org A
- User 3: BASE role in Org A
- User 4: SELF_SERVICE role in Org A
- User 5: ADMIN role in Org B (for cross-org tests)

### Bookings

- Booking 1: DRAFT status, no assets
- Booking 2: RESERVED status, 5 assets, 1 kit
- Booking 3: ONGOING status, 10 assets
- Booking 4: COMPLETE status with 50+ activity notes
- Booking 5: Pre-existing booking (created before activity log feature)

### Assets & Kits

- 20 standalone assets
- 3 kits with 5 assets each

---

## Known Limitations & Future Enhancements

### Current Limitations

1. No pagination on Activity tab (may impact performance with 1000+ notes)
2. No filtering or search within activity logs
3. No ability to edit manual notes (only delete)
4. No bulk delete for manual notes
5. CSV export may timeout with extremely large datasets

### Potential Future Enhancements

1. Pagination or infinite scroll for activity lists
2. Filter activity by type (COMMENT vs UPDATE), date range, user
3. Search within activity notes
4. Edit manual notes with edit history
5. Real-time updates (websockets) for multi-user scenarios
6. Activity log for more entities (assets, kits, custodies)
7. Configurable activity log verbosity (detailed vs summary)

---

## Testing Tools & Automation

### Manual Testing

- Use browser dev tools to simulate network failures
- Test with different roles using incognito windows
- Use browser's Performance tab to measure load times

### Automated Testing

- Unit tests exist: `app/modules/booking-note/service.server.test.ts`
- Integration tests should cover:
  - API endpoints (activity route loader/action)
  - Permission validation
  - CSV export generation
  - Database cascade operations

### Performance Testing

- Load test Activity tab with 1000+ notes
- Stress test concurrent note creation
- Measure database query performance with indexes

### Browser Testing

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Mobile browsers (iOS Safari, Chrome Android)

---

## Sign-Off Checklist

- [ ] All P0 scenarios pass (19 total)
- [ ] All critical regression tests pass (5 total)
- [ ] Permission system validated for all 4 roles
- [ ] CSV export works for various data sizes
- [ ] Database migration tested on staging
- [ ] Performance impact assessed (no degradation)
- [ ] Error handling validated
- [ ] Cross-browser testing completed
- [ ] Documentation updated (if needed)
- [ ] Stakeholder demo completed

---

**Last Updated**: 2026-01-19
**Feature Branch**: `claude/qa-audits-test-scenarios-XmIo7`
**Tested By**: _Pending_
**Status**: Ready for QA
