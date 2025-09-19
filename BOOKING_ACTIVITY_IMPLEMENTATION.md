# Booking Activity Log Implementation

## Overview

This document describes the implementation of the booking activity log feature, which provides comprehensive activity tracking for bookings similar to the existing asset notes system.

## Architecture

### Database Schema

The implementation adds a new `BookingNote` model that mirrors the existing `Note` model structure:

```prisma
model BookingNote {
  id      String   @id @default(cuid())
  content String
  type    NoteType @default(COMMENT)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  user      User?    @relation("BookingNoteUser", fields: [userId], references: [id])
  userId    String?
  booking   Booking  @relation(fields: [bookingId], references: [id])
  bookingId String

  @@index([bookingId])
  @@index([userId])
}
```

### Service Layer

Located in `app/modules/booking-note/service.server.ts`:

- `createBookingNote()` - Creates manual notes with user attribution
- `createSystemBookingNote()` - Creates automatic activity logs
- `getBookingNotes()` - Retrieves notes with security checks
- `deleteBookingNote()` - Allows users to delete their own notes

### Permissions

Added `bookingNote` entity to the permission system:

- `PermissionAction.read` - View booking activity
- `PermissionAction.create` - Add manual notes

Both BASE and SELF_SERVICE roles have read/create permissions.

## Activity Tracking

### Automatic Events Logged

The system automatically creates activity notes for:

1. **Status Changes**:

   - Booking reservation (DRAFT → RESERVED)
   - Booking cancellation (→ CANCELLED)
   - Booking archival (→ ARCHIVED)

2. **Detail Updates**:

   - Name changes
   - Description changes
   - Date changes (start/end)
   - Custodian assignment changes

3. **Asset Management**:

   - Asset additions to bookings

4. **Check-in/Check-out Operations**:
   - Booking check-ins
   - Booking check-outs

### Activity Message Format

All system-generated messages use markdown formatting for consistency:

- Status changes: `"Booking status changed from **DRAFT** to **RESERVED**."`
- Updates: `"Booking updated: name from **Old Name** to **New Name**."`
- Check-ins: `"**John Doe** checked in booking **Booking Name**."`

## User Interface

### Routes

- `/bookings/:bookingId/activity` - Main activity view
- `/bookings/:bookingId/note` - Note creation/deletion API

### Components

Located in `app/components/booking/notes/`:

- `index.tsx` - Main notes display component
- `new.tsx` - Note creation form with markdown editor
- `note.tsx` - Individual note display component
- `actions-dropdown.tsx` - Note management actions

### Features

- **Optimistic UI**: Immediate feedback when creating notes
- **Markdown Support**: Full markdown rendering and editing
- **Type Distinction**: Visual difference between manual (COMMENT) and system (UPDATE) notes
- **Permissions Integration**: Conditional rendering based on user roles
- **Responsive Design**: Mobile-friendly interface

## Integration Points

### Booking Service Updates

The following functions in `app/modules/booking/service.server.ts` now include activity logging:

- `reserveBooking()` - Logs status change to RESERVED
- `updateBasicBooking()` - Logs field changes (name, description, dates, custodian)
- `cancelBooking()` - Logs cancellation
- `archiveBooking()` - Logs archival
- `updateBookingAssets()` - Logs asset additions

### Booking Route Updates

The main booking route (`app/routes/_layout+/bookings.$bookingId.tsx`) now includes:

- Import of booking note service
- Activity logging for check-in/check-out operations
- Maintains existing asset note logging for backward compatibility

## Testing

### Unit Tests

Located in `app/modules/booking-note/service.server.test.ts`:

- Tests all service functions with mocked dependencies
- Covers error scenarios and edge cases
- Validates proper data handling and security

### Manual Testing

See `test/booking-activity-manual-test.md` for comprehensive manual testing procedures covering:

- All automatic activity logging scenarios
- Manual note creation and deletion
- Permission testing
- UI functionality validation

## Security Considerations

1. **Organization Isolation**: Notes are scoped to organization via booking relationship
2. **User Authorization**: Only note creators can delete their manual notes
3. **System Note Protection**: System-generated notes cannot be deleted
4. **Permission Validation**: All operations check appropriate permissions

## Performance Considerations

1. **Indexed Queries**: Database indexes on `bookingId` and `userId` for efficient lookups
2. **Optimistic UI**: Immediate feedback reduces perceived latency
3. **Selective Loading**: Notes loaded only when activity tab is accessed
4. **Efficient Pagination**: Notes ordered by creation date (desc) for recent-first display

## Migration Requirements

To deploy this feature:

1. **Database Migration**: Apply schema changes to add BookingNote model
2. **Permission Updates**: Ensure role configurations include bookingNote permissions
3. **Dependency Updates**: No new external dependencies required
4. **Environment**: No new environment variables needed

## Future Enhancements

Potential future improvements:

1. **Bulk Activity Logs**: For operations affecting multiple assets/bookings
2. **Activity Filtering**: Filter by activity type or date range
3. **Activity Export**: Export activity history as PDF or CSV
4. **Rich Content**: Support for file attachments in manual notes
5. **Notifications**: Real-time notifications for activity updates
6. **Activity Templates**: Pre-defined templates for common manual notes

## Troubleshooting

### Common Issues

1. **Missing Activity**: Ensure booking service functions include activity logging calls
2. **Permission Errors**: Verify user roles include bookingNote permissions
3. **UI Not Loading**: Check nested route configuration and permissions
4. **Type Errors**: Ensure Prisma types are generated after schema changes

### Debug Information

- Activity notes have `type` field distinguishing COMMENT vs UPDATE
- All automatic activities are created with `type: "UPDATE"`
- Manual notes default to `type: "COMMENT"`
- System notes have `userId: null`

## Related Files

### Core Implementation

- `app/database/schema.prisma` - BookingNote model definition
- `app/modules/booking-note/service.server.ts` - Service layer
- `app/components/booking/notes/` - UI components
- `app/routes/_layout+/bookings.$bookingId.activity.tsx` - Activity route
- `app/routes/_layout+/bookings.$bookingId.note.tsx` - Note API route

### Integration Points

- `app/modules/booking/service.server.ts` - Activity logging integration
- `app/routes/_layout+/bookings.$bookingId.tsx` - Check-in/out logging
- `app/utils/permissions/permission.data.ts` - Permission configuration

### Testing

- `app/modules/booking-note/service.server.test.ts` - Unit tests
- `test/booking-activity-manual-test.md` - Manual testing guide
