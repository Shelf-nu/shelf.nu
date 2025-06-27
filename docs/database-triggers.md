# Database Triggers

This document contains information about all PostgreSQL triggers used in Shelf.nu. Triggers are database-level functions that automatically execute in response to certain events (like INSERT, UPDATE, DELETE) on specific tables.

## Why We Use Triggers

Triggers help us maintain data consistency and automatically handle certain operations at the database level, ensuring they happen regardless of which application code path creates or modifies data.

## Viewing Triggers

You can view and manage these triggers in several ways:

### Supabase Dashboard

1. Go to your Supabase project dashboard
2. Navigate to **Database** → **Triggers**
3. All triggers will be listed with their associated tables and functions

### Database Query

```sql
-- List all triggers
SELECT
    trigger_name,
    event_manipulation,
    event_object_table,
    action_statement
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table, trigger_name;
```

## Current Triggers

### `trigger_create_user_contact`

**Purpose**: Automatically creates a `UserContact` record whenever a new `User` is created.

**Table**: `User`  
**Event**: `AFTER INSERT`  
**Function**: `create_user_contact_on_user_insert()`

**Migration File**: [`20250617074555_create_trigger_that_create_user_contact_on_insert_in_user_table`](https://github.com/Shelf-nu/shelf.nu/tree/main/app/database/migrations/20250617074555_create_trigger_that_create_user_contact_on_insert_in_user_table/migration.sql)

**What it does**:

- Triggers after a new user is inserted into the `User` table
- Creates a corresponding empty `UserContact` record with the new user's ID
- Ensures every user always has contact information available (even if empty)
- Generates a proper cuid-compatible ID for the contact record

**Why we use it**:
We have multiple user creation flows throughout the application (registration, invitations, SSO, etc.). Rather than updating every code path to create contact records, this trigger ensures consistency at the database level.

---

### `booking_audit_trigger`

**Purpose**: Automatically creates comprehensive audit records for all booking changes, capturing complete snapshots of booking data including relationships.

**Table**: `Booking`  
**Event**: `AFTER INSERT OR UPDATE OR DELETE`  
**Function**: `log_booking_changes()`

**Supporting Functions**:

- `get_booking_snapshot()` - Captures complete booking data with all relationships
- `get_changed_fields()` - Detects which specific fields changed

**What it does**:

- Triggers after any booking is created, updated, or deleted
- Creates a `BookingChange` record with complete before/after snapshots
- Captures both `bookingId` and `organizationId` for secure, fast queries
- Captures full user details (creator, custodian user, custodian team member) at the time of change
- Includes all associated assets with their kit, category, and location relationships
- Includes all associated tags with their configuration
- Stores what specific fields changed for efficient querying
- For DELETE operations, preserves the complete booking state that was deleted

**Why we use it**:
Bookings are critical business data involving multiple users, valuable assets, and complex relationships. This trigger ensures we have a complete audit trail for compliance, accountability, and debugging purposes. It captures historical context that might be lost if users change names, assets are moved between kits, or relationships are modified after the fact. The `organizationId` field enables secure, fast queries and prevents cross-organization data access.

---

### `booking_asset_audit_trigger`

**Purpose**: Automatically tracks when assets are added to or removed from bookings.

**Table**: `_AssetToBooking` (Prisma relation table)  
**Event**: `AFTER INSERT OR DELETE`  
**Function**: `log_booking_asset_changes()`

**What it does**:

- Triggers when the many-to-many relationship between bookings and assets changes
- Creates `BookingChange` records with `changeType` of `ASSET_ADDED` or `ASSET_REMOVED`
- Captures both `bookingId` and `organizationId` (looked up from the booking) for secure queries
- Captures the complete booking state after the asset relationship change
- Includes full asset details including kit, category, and location information at the time of change

**Why we use it**:
Asset relationships can change independently of booking updates. This trigger ensures we track these changes separately, which is crucial for understanding kit usage patterns and asset movement history. Since kits connect to bookings through assets, this trigger is essential for kit audit trails. The `organizationId` ensures these audit records can be queried securely and efficiently.

---

### `booking_tag_audit_trigger`

**Purpose**: Automatically tracks when tags are added to or removed from bookings.

**Table**: `_BookingToTag` (Prisma relation table)  
**Event**: `AFTER INSERT OR DELETE`  
**Function**: `log_booking_tag_changes()`

**What it does**:

- Triggers when the many-to-many relationship between bookings and tags changes
- Creates `BookingChange` records with `changeType` of `TAG_ADDED` or `TAG_REMOVED`
- Captures both `bookingId` and `organizationId` (looked up from the booking) for secure queries
- Captures the complete booking state after the tag relationship change
- Includes full tag details including their `useFor` configuration

**Why we use it**:
Tags are used for categorization and workflow management of bookings. This trigger ensures we maintain a history of how bookings were tagged over time, which is valuable for understanding booking patterns, workflow changes, and organizational processes. The `organizationId` enables secure, organization-scoped audit queries.

---

## Booking Audit System Overview

The booking audit triggers work together to provide comprehensive change tracking:

### Data Captured

For each booking change, the system captures:

- **Complete booking data**: All booking fields at the time of change
- **User context**: Full details of creator, custodian user, and custodian team member
- **Asset relationships**: Complete asset data including kit, category, and location details
- **Tag relationships**: All associated tags and their configuration
- **Change metadata**: What changed, when, and what type of change occurred

### Change Types Tracked

- `CREATE` - New booking created
- `UPDATE` - Booking fields modified
- `DELETE` - Booking deleted
- `ASSET_ADDED` - Asset added to booking
- `ASSET_REMOVED` - Asset removed from booking
- `TAG_ADDED` - Tag added to booking
- `TAG_REMOVED` - Tag removed from booking

### Example Audit Data Structure

```json
{
  "bookingAfter": {
    "id": "booking123",
    "name": "Camera Equipment Rental",
    "status": "ONGOING",
    "creator": {
      "id": "user123",
      "email": "john.smith@company.com",
      "firstName": "John",
      "lastName": "Smith"
    },
    "assets": [
      {
        "id": "asset1",
        "title": "Canon EOS R5",
        "kit": {
          "id": "kit1",
          "name": "Camera Kit Pro",
          "status": "IN_CUSTODY"
        }
      }
    ],
    "tags": [
      {
        "id": "tag1",
        "name": "High Priority",
        "useFor": ["BOOKING"]
      }
    ]
  }
}
```

---

## Adding New Triggers

When adding new triggers to the project:

1. **Create an empty Prisma migration**:

   ```bash
   npm run db:prepare-migration
   ```

2. **Add the trigger SQL** to the migration file:

   ```sql
   -- CreateFunction
   CREATE OR REPLACE FUNCTION your_trigger_function()
   RETURNS TRIGGER AS '
   BEGIN
       -- Your trigger logic here
       -- Note: Use double single quotes ('''') to escape single quotes in strings
       RETURN NEW; -- or OLD for DELETE triggers
   END;
   ' LANGUAGE plpgsql;

   -- CreateTrigger
   CREATE OR REPLACE TRIGGER your_trigger_name
       AFTER INSERT ON "YourTable" -- or BEFORE, UPDATE, DELETE
       FOR EACH ROW
       EXECUTE FUNCTION your_trigger_function();
   ```

   **Important**: Use single quotes (`'...'`) instead of dollar-quoted strings (`$...$`) in Prisma migrations. If you need single quotes inside your function, escape them by doubling (`''`).

3. **Document the trigger** in this file by adding a new section above

4. **Test thoroughly** to ensure the trigger works as expected

## Trigger Best Practices

- **Keep triggers simple** - Complex business logic should stay in application code
- **Avoid triggers calling external services** - This can cause performance issues
- **Test edge cases** - Triggers run for ALL operations, including bulk operations
- **Use `AFTER` triggers** when possible to avoid interfering with the main operation
- **Handle errors gracefully** - A trigger error will rollback the entire transaction

## Troubleshooting

### Trigger Not Firing

1. Check if the trigger exists: Query `information_schema.triggers`
2. Verify the trigger is enabled
3. Check for syntax errors in the trigger function
4. Ensure the trigger event matches your operation (INSERT vs UPDATE)

### Performance Issues

1. Keep trigger functions lightweight
2. Avoid recursive triggers (triggers that modify the same table)
3. Use `NEW` and `OLD` records efficiently
4. Consider if the operation could be handled in application code instead

### Debugging Triggers

```sql
-- Enable trigger debugging (if needed)
SET log_statement = 'all';
SET log_min_duration_statement = 0;

-- View trigger function source
SELECT pg_get_functiondef(oid)
FROM pg_proc
WHERE proname = 'your_function_name';
```

## Migration Management

When modifying triggers:

1. **Always use migrations** - Don't modify triggers directly in production
2. **Drop and recreate** - Use `CREATE OR REPLACE` for functions, but drop/create for triggers
3. **Test with existing data** - Ensure triggers work with current database state
4. **Document breaking changes** - Update this documentation when triggers change behavior
