-- Backfill existing tags with default useFor value
UPDATE "Tag" SET "useFor" = ARRAY['ASSET']::"TagUseFor"[] 
WHERE "useFor" IS NULL OR array_length("useFor", 1) IS NULL;