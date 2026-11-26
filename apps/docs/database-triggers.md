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

**Migration File**: [`20250617074555_create_trigger_that_create_user_contact_on_insert_in_user_table`](https://github.com/Shelf-nu/shelf.nu/tree/main/packages/database/prisma/migrations/20250617074555_create_trigger_that_create_user_contact_on_insert_in_user_table/migration.sql)

**What it does**:

- Triggers after a new user is inserted into the `User` table
- Creates a corresponding empty `UserContact` record with the new user's ID
- Ensures every user always has contact information available (even if empty)
- Generates a proper cuid-compatible ID for the contact record

**Why we use it**:
We have multiple user creation flows throughout the application (registration, invitations, SSO, etc.). Rather than updating every code path to create contact records, this trigger ensures consistency at the database level.

---

### Booking source contract (`booking_source_contract_*`)

**Purpose**: Enforces the booking source contract on the final state of every transaction that touches a booking slice, its source rows, its disposition shares or a booking's consumption logs.

**Migration File**: [`20261112100100_booking_source_contract`](https://github.com/Shelf-nu/shelf.nu/tree/main/packages/database/prisma/migrations/20261112100100_booking_source_contract/migration.sql)

| Trigger                                 | Table                     | Kind                                        | Events                                              |
| --------------------------------------- | ------------------------- | ------------------------------------------- | --------------------------------------------------- |
| `booking_asset_source_first_mode`       | `BookingAsset`            | immediate, `AFTER ... FOR EACH ROW`         | UPDATE, only when the old or new mode is not LEGACY |
| `booking_source_contract_booking_asset` | `BookingAsset`            | constraint, `DEFERRABLE INITIALLY DEFERRED` | INSERT, UPDATE, DELETE                              |
| `booking_source_contract_source`        | `BookingAssetSource`      | constraint, `DEFERRABLE INITIALLY DEFERRED` | INSERT, UPDATE, DELETE                              |
| `booking_source_contract_share`         | `BookingDispositionShare` | constraint, `DEFERRABLE INITIALLY DEFERRED` | INSERT, UPDATE, DELETE                              |
| `booking_source_contract_log_insert`    | `ConsumptionLog`          | constraint, `DEFERRABLE INITIALLY DEFERRED` | INSERT, only when `bookingId` is set                |
| `booking_source_contract_log_update`    | `ConsumptionLog`          | constraint, `DEFERRABLE INITIALLY DEFERRED` | UPDATE, only when the old or new `bookingId` is set |
| `booking_source_contract_log_delete`    | `ConsumptionLog`          | constraint, `DEFERRABLE INITIALLY DEFERRED` | DELETE, only when `bookingId` was set               |

**What it does**:

- The immediate trigger records a slice's `sourceAllocation` at its first update that involves a non-LEGACY mode, in a per-transaction temp table (`pg_temp.booking_source_first_mode`, `ON COMMIT DROP`). Inserts and LEGACY to LEGACY updates record nothing: a LEGACY first mode can never fail the no-downgrade check.
- **LEGACY fast path**: a `BookingAsset` write that is LEGACY before and after, or a booking `ConsumptionLog` write, whose `(bookingId, assetId)` group is unconverted at commit (no non-LEGACY slice and no share row) returns after `booking_source_group_is_converted` and creates no temp table. Cost per write: one exact probe of `BookingAsset_manual_unique`, one probe of `AssetKit_assetId_kitId_key` for the asset's kits plus one exact `BookingAsset_kit_unique` probe per kit of that asset, and one probe of `BookingDispositionShare_bookingId_assetId_idx`. An `UPDATE` pays this twice only when it moves the row to another `(bookingId, assetId)` group. Today's check-in, check-out and scan-add writes take this path. The triggers on `BookingAssetSource` and `BookingDispositionShare` always enqueue, so a source row on a LEGACY slice is still caught.
- At COMMIT the deferred triggers derive the affected slice ids and `(bookingId, assetId)` group keys from each row's old and new values, and add each key once to `pg_temp.booking_source_checked`. The call that adds a key runs `check_booking_source_slice(sliceId)` or `check_booking_source_group(bookingId, assetId)` against the final state, so each slice and group is checked once per transaction.
- A slice that no longer exists is skipped. A group whose booking no longer exists is skipped. A group with no slices left is still checked, because its orphaned shares remain.
- A violation raises `booking_source_check_<n>: <detail>` with SQLSTATE `check_violation` (23514), `n` being the contract check number (1 to 10). The migration file lists every check.

**Why we use it**: source rows and disposition shares must agree with the slice counters across many writers (check-out, check-in, kit changes, location delete, conversion). Checking the final state at COMMIT catches a missed writer, while letting a writer pass through intermediate states inside its transaction. Unconverted (LEGACY) groups only get the no-downgrade, LEGACY-group and no-source-row checks, so writers that know nothing about source rows keep working unchanged.

**Not watched**: checks 4 and 6 read `Asset.type`, `Asset.organizationId`, `Booking.organizationId` and `Location.organizationId`, but writes to `Asset`, `Booking` and `Location` do not enqueue a check. Moving one of those rows to another workspace, or changing an asset's type, is not re-checked here.

**Scaling watch item**: every transaction that touches a converted group creates and drops two temp tables (`ON COMMIT DROP`), which churns the system catalog. Fine at today's volume; watch catalog bloat (`pg_class`, `pg_attribute`) as converted groups become the common case.

**Do not** set these constraint triggers `IMMEDIATE` in a transaction that writes these tables, whether `SET CONSTRAINTS` names them or uses `ALL`: each key is checked once per transaction, so a check fired early is not repeated for later writes.

---

## Adding New Triggers

When adding new triggers to the project:

1. **Create an empty Prisma migration**:

   ```bash
   pnpm db:prepare-migration
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
