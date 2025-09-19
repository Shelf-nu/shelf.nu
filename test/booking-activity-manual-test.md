# Booking Activity Log Manual Test Plan

## Overview

This document outlines manual testing steps to verify the booking activity log functionality works correctly.

## Prerequisites

1. Database has been migrated to include BookingNote model
2. Application is running with proper environment configuration
3. User has necessary permissions to create and manage bookings

## Test Cases

### 1. Booking Creation Activity

**Objective**: Verify that creating a booking doesn't create activity notes (creation is handled separately)
**Steps**:

1. Navigate to bookings page
2. Click "New Booking"
3. Fill in booking details (name, description, dates, custodian)
4. Save booking
5. Navigate to booking detail page
6. Click on "Activity" tab

**Expected Result**: Only basic booking creation should be visible, no duplicate activity notes

### 2. Status Change Activity - Reserve Booking

**Objective**: Verify that reserving a booking creates an activity note
**Steps**:

1. Create a draft booking with assets
2. Reserve the booking
3. Navigate to booking detail page → Activity tab

**Expected Result**: Activity note should show "Booking status changed from **DRAFT** to **RESERVED**."

### 3. Booking Detail Updates Activity

**Objective**: Verify that updating booking details creates activity notes
**Steps**:

1. Edit an existing booking
2. Change the name from "Original Name" to "Updated Name"
3. Change description from "Original Description" to "Updated Description"
4. Save changes
5. Check Activity tab

**Expected Result**: Activity note should show "Booking updated: name from **Original Name** to **Updated Name**, description from **Original Description** to **Updated Description**."

### 4. Check-in Activity

**Objective**: Verify that checking in a booking creates activity notes
**Steps**:

1. Have a reserved booking ready for check-in
2. Check in the booking
3. Navigate to Activity tab

**Expected Result**: Activity note should show "[User Name] checked in booking [Booking Name]."

### 5. Check-out Activity

**Objective**: Verify that checking out a booking creates activity notes
**Steps**:

1. Have an ongoing booking ready for check-out
2. Check out the booking
3. Navigate to Activity tab

**Expected Result**: Activity note should show "[User Name] checked out booking [Booking Name]."

### 6. Asset Addition Activity

**Objective**: Verify that adding assets to booking creates activity notes
**Steps**:

1. Open an existing booking
2. Add 3 new assets to the booking
3. Check Activity tab

**Expected Result**: Activity note should show "3 assets added to booking."

### 7. Cancel Booking Activity

**Objective**: Verify that cancelling a booking creates activity notes
**Steps**:

1. Have a reserved or ongoing booking
2. Cancel the booking
3. Check Activity tab

**Expected Result**: Activity note should show "Booking cancelled. Status changed from **[PREVIOUS_STATUS]** to **CANCELLED**."

### 8. Archive Booking Activity

**Objective**: Verify that archiving a completed booking creates activity notes
**Steps**:

1. Have a completed booking
2. Archive the booking
3. Check Activity tab

**Expected Result**: Activity note should show "Booking archived. Status changed from **COMPLETE** to **ARCHIVED**."

### 9. Manual Note Creation

**Objective**: Verify that users can create manual notes
**Steps**:

1. Navigate to booking Activity tab
2. Type a manual note in the note input field
3. Submit the note
4. Verify note appears in activity list

**Expected Result**: Manual note should appear with user name, timestamp, and be marked as "COMMENT" type

### 10. Note Deletion

**Objective**: Verify that users can delete their own manual notes
**Steps**:

1. Create a manual note (as per test 9)
2. Click actions dropdown on the note
3. Select "Delete"
4. Confirm deletion

**Expected Result**: Note should be removed from activity list

### 11. Permissions Testing

**Objective**: Verify that permissions work correctly
**Steps**:

1. Login with user that has bookingNote read permissions
2. Navigate to booking activity tab
3. Verify can see notes
4. Login with user without bookingNote permissions
5. Navigate to booking activity tab

**Expected Result**:

- User with permissions should see activity and note creation form
- User without permissions should see "Insufficient permissions" message

### 12. Activity Timeline Order

**Objective**: Verify that activity notes are displayed in correct chronological order
**Steps**:

1. Perform multiple actions on a booking (reserve, add assets, check-in, add manual note)
2. Check Activity tab

**Expected Result**: All activities should be listed with most recent first, showing correct timestamps

## Expected UI Elements

### Activity Tab

- Should be accessible from booking detail page
- Should show chronological list of activities
- Should distinguish between system-generated (UPDATE) and manual (COMMENT) notes
- Should show user names and timestamps for all activities
- Should provide note creation form for users with proper permissions

### Note Display

- System notes should show just timestamp and content
- Manual notes should show timestamp, user name, and actions dropdown
- Content should support markdown formatting
- Each note should have appropriate styling based on type

## Security Considerations

- Users should only be able to delete their own manual notes
- System-generated notes should not be deletable
- Activity should only be visible to users with proper permissions
- Cross-organization access should be prevented

## Performance Considerations

- Activity loading should be reasonably fast
- Large number of activities should not impact page performance significantly
- Note creation should provide immediate feedback (optimistic UI)
