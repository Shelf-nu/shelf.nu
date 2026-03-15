-- =============================================================================
-- 007_supabase_features.sql
-- Enable Supabase-specific features: realtime, storage buckets, extensions
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Extensions
--    pg_trgm already enabled in 001. Add any additional required extensions.
-- ---------------------------------------------------------------------------

-- pgcrypto for gen_random_uuid() (usually enabled by default in Supabase,
-- but ensure it's available)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 2. Realtime subscriptions on key tables
--    Enables Supabase Realtime to broadcast changes via WebSockets
-- ---------------------------------------------------------------------------

-- Supabase Realtime is configured via the supabase_realtime publication
-- Create it if it doesn't exist, then add tables
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

ALTER PUBLICATION supabase_realtime ADD TABLE "Asset";
ALTER PUBLICATION supabase_realtime ADD TABLE person;
ALTER PUBLICATION supabase_realtime ADD TABLE "Custody";
ALTER PUBLICATION supabase_realtime ADD TABLE "Booking";
ALTER PUBLICATION supabase_realtime ADD TABLE "Kit";
ALTER PUBLICATION supabase_realtime ADD TABLE asset_status_config;

-- ---------------------------------------------------------------------------
-- 3. Storage bucket for asset images
--    Replaces Prisma Image.blob (bytea) with Supabase Storage for new uploads
-- ---------------------------------------------------------------------------

-- Create the storage bucket (Supabase Storage API)
-- Note: This uses Supabase's storage schema. In a real deployment, this
-- would be configured via the Supabase dashboard or CLI. Including here
-- for completeness.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'asset-images',
  'asset-images',
  false,  -- Private bucket, accessed via signed URLs
  10485760,  -- 10MB max file size
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for the asset-images bucket
-- T1 (MSP staff): full access
CREATE POLICY "t1_asset_images_select" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'asset-images'
    AND auth.tenant_tier() = 'T1'
  );

CREATE POLICY "t1_asset_images_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'asset-images'
    AND auth.tenant_tier() = 'T1'
  );

CREATE POLICY "t1_asset_images_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'asset-images'
    AND auth.tenant_tier() = 'T1'
  );

CREATE POLICY "t1_asset_images_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'asset-images'
    AND auth.tenant_tier() = 'T1'
  );

-- T2 (Client users): read-only access to their company's images
CREATE POLICY "t2_asset_images_select" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'asset-images'
    AND auth.tenant_tier() = 'T2'
  );
