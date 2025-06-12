-- CreateEnum
CREATE TYPE "ChangeType" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'ASSET_ADDED', 'ASSET_REMOVED');

-- CreateTable
CREATE TABLE "BookingChange" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "changeType" "ChangeType" NOT NULL,
    "changedBy" TEXT,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "bookingBefore" JSONB,
    "bookingAfter" JSONB NOT NULL,
    "changedFields" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookingChange_bookingId_createdAt_idx" ON "BookingChange"("bookingId", "createdAt");

-- CreateIndex
CREATE INDEX "BookingChange_changeType_createdAt_idx" ON "BookingChange"("changeType", "createdAt");

-- CreateIndex
CREATE INDEX "BookingChange_changedBy_createdAt_idx" ON "BookingChange"("changedBy", "createdAt");

-- AddForeignKey
ALTER TABLE "BookingChange" ADD CONSTRAINT "BookingChange_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- EnableRowLevelSecurity
ALTER TABLE "BookingChange" ENABLE row level security;


-- Function to capture complete booking data with all relationships
CREATE OR REPLACE FUNCTION get_booking_snapshot(booking_id text)
RETURNS jsonb AS $$
DECLARE
    booking_data jsonb;
    assets_data jsonb;
BEGIN
    -- Get the main booking data with user relationships
    SELECT 
        to_jsonb(b.*) ||
        jsonb_build_object(
            -- Capture full creator data
            'creator', CASE 
                WHEN creator.id IS NOT NULL THEN jsonb_build_object(
                    'id', creator.id,
                    'email', creator.email,
                    'username', creator.username,
                    'firstName', creator."firstName",
                    'lastName', creator."lastName"
                )
                ELSE NULL
            END,
            -- Capture full custodian user data
            'custodianUser', CASE 
                WHEN custodian_user.id IS NOT NULL THEN jsonb_build_object(
                    'id', custodian_user.id,
                    'email', custodian_user.email,
                    'username', custodian_user.username,
                    'firstName', custodian_user."firstName",
                    'lastName', custodian_user."lastName"
                )
                ELSE NULL
            END,
            -- Capture full custodian team member data
            'custodianTeamMember', CASE 
                WHEN custodian_tm.id IS NOT NULL THEN jsonb_build_object(
                    'id', custodian_tm.id,
                    'name', custodian_tm.name,
                    'userId', custodian_tm."userId"
                )
                ELSE NULL
            END
        ) INTO booking_data
    FROM "Booking" b
    LEFT JOIN "User" creator ON b."creatorId" = creator.id
    LEFT JOIN "User" custodian_user ON b."custodianUserId" = custodian_user.id
    LEFT JOIN "TeamMember" custodian_tm ON b."custodianTeamMemberId" = custodian_tm.id
    WHERE b.id = booking_id;
    
    -- Get associated assets with their complete relationship data
    SELECT jsonb_agg(
        jsonb_build_object(
            'id', a.id,
            'title', a.title,
            'description', a.description,
            'status', a.status,
            'valuation', a.valuation,
            'availableToBook', a."availableToBook",
            'categoryId', a."categoryId",
            'locationId', a."locationId",
            'kitId', a."kitId",
            -- Include full kit data if the asset belongs to a kit
            'kit', CASE 
                WHEN k.id IS NOT NULL THEN jsonb_build_object(
                    'id', k.id,
                    'name', k.name,
                    'description', k.description,
                    'status', k.status
                )
                ELSE NULL
            END,
            -- Include full category data
            'category', CASE 
                WHEN c.id IS NOT NULL THEN jsonb_build_object(
                    'id', c.id,
                    'name', c.name,
                    'color', c.color
                )
                ELSE NULL
            END,
            -- Include full location data
            'location', CASE 
                WHEN l.id IS NOT NULL THEN jsonb_build_object(
                    'id', l.id,
                    'name', l.name,
                    'description', l.description
                )
                ELSE NULL
            END
        )
    ) INTO assets_data
    FROM "Asset" a
    INNER JOIN "_AssetToBooking" ab ON a.id = ab."A"
    LEFT JOIN "Kit" k ON a."kitId" = k.id
    LEFT JOIN "Category" c ON a."categoryId" = c.id
    LEFT JOIN "Location" l ON a."locationId" = l.id
    WHERE ab."B" = booking_id;
    
    -- Combine booking data with assets
    booking_data := booking_data || jsonb_build_object('assets', COALESCE(assets_data, '[]'::jsonb));
    
    RETURN booking_data;
END;
$$ LANGUAGE plpgsql;

-- Function to detect changed fields between old and new data
CREATE OR REPLACE FUNCTION get_changed_fields(old_data jsonb, new_data jsonb)
RETURNS text[] AS $$
DECLARE
    changed_fields text[] := ARRAY[]::text[];
    key text;
BEGIN
    -- Compare each field
    FOR key IN SELECT jsonb_object_keys(new_data)
    LOOP
        IF old_data->>key IS DISTINCT FROM new_data->>key THEN
            changed_fields := array_append(changed_fields, key);
        END IF;
    END LOOP;
    
    RETURN changed_fields;
END;
$$ LANGUAGE plpgsql;

-- Main trigger function for booking changes
CREATE OR REPLACE FUNCTION log_booking_changes()
RETURNS trigger AS $$
DECLARE
    change_type text;
    booking_before jsonb := NULL;
    booking_after jsonb := NULL;
    changed_fields text[] := ARRAY[]::text[];
    change_id text;
BEGIN
    -- Generate change ID
    SELECT gen_random_uuid()::text INTO change_id;
    
    IF TG_OP = 'INSERT' THEN
        change_type := 'CREATE';
        booking_after := get_booking_snapshot(NEW.id);
        changed_fields := ARRAY['*']; -- All fields for new records
        
    ELSIF TG_OP = 'UPDATE' THEN
        change_type := 'UPDATE';
        booking_before := get_booking_snapshot(OLD.id);
        booking_after := get_booking_snapshot(NEW.id);
        changed_fields := get_changed_fields(
            to_jsonb(OLD.*), 
            to_jsonb(NEW.*)
        );
        
    ELSIF TG_OP = 'DELETE' THEN
        change_type := 'DELETE';
        booking_before := get_booking_snapshot(OLD.id);
        changed_fields := ARRAY['*']; -- All fields for deleted records
    END IF;
    
    -- Only log if there are actual changes
    IF array_length(changed_fields, 1) > 0 THEN
        INSERT INTO "BookingChange" (
            id,
            "bookingId",
            "changeType",
            "bookingBefore",
            "bookingAfter",
            "changedFields",
            "createdAt"
        ) VALUES (
            change_id,
            COALESCE(NEW.id, OLD.id),
            change_type,
            booking_before,
            booking_after,
            changed_fields,
            NOW()
        );
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Create the main booking trigger
DROP TRIGGER IF EXISTS booking_audit_trigger ON "Booking";
CREATE TRIGGER booking_audit_trigger
    AFTER INSERT OR UPDATE OR DELETE ON "Booking"
    FOR EACH ROW EXECUTE FUNCTION log_booking_changes();

-- Trigger function for asset relationship changes
CREATE OR REPLACE FUNCTION log_booking_asset_changes()
RETURNS trigger AS $$
DECLARE
    change_type text;
    booking_after jsonb;
    change_id text;
BEGIN
    -- Generate change ID
    SELECT gen_random_uuid()::text INTO change_id;
    
    IF TG_OP = 'INSERT' THEN
        change_type := 'ASSET_ADDED';
        booking_after := get_booking_snapshot(NEW."B");
        
        INSERT INTO "BookingChange" (
            id,
            "bookingId",
            "changeType",
            "bookingAfter",
            "changedFields",
            "createdAt"
        ) VALUES (
            change_id,
            NEW."B",
            change_type,
            booking_after,
            ARRAY['assets'],
            NOW()
        );
        
    ELSIF TG_OP = 'DELETE' THEN
        change_type := 'ASSET_REMOVED';
        booking_after := get_booking_snapshot(OLD."B");
        
        INSERT INTO "BookingChange" (
            id,
            "bookingId",
            "changeType",
            "bookingAfter",
            "changedFields",
            "createdAt"
        ) VALUES (
            change_id,
            OLD."B",
            change_type,
            booking_after,
            ARRAY['assets'],
            NOW()
        );
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Create trigger for asset relationship changes
DROP TRIGGER IF EXISTS booking_asset_audit_trigger ON "_AssetToBooking";
CREATE TRIGGER booking_asset_audit_trigger
    AFTER INSERT OR DELETE ON "_AssetToBooking"
    FOR EACH ROW EXECUTE FUNCTION log_booking_asset_changes();
