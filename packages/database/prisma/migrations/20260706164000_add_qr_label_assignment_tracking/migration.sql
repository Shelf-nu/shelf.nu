ALTER TABLE "Asset" ADD COLUMN "qrLabelAppliedAt" TIMESTAMP(3);

-- Migrations are deployed before the new application version. Keep recording
-- assignments made by an older application process during that rollout window.
-- This only runs when an existing QR changes assets, so the QR inserted with a
-- newly-created asset remains unmarked.
CREATE OR REPLACE FUNCTION set_qr_label_applied_at_on_assignment()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."assetId" IS NOT NULL
    AND NEW."assetId" IS DISTINCT FROM OLD."assetId" THEN
    UPDATE "Asset" a
    SET "qrLabelAppliedAt" = CURRENT_TIMESTAMP
    WHERE a.id = NEW."assetId"
      AND NEW."kitId" IS NULL
      AND (
        NEW."organizationId" IS NULL OR
        NEW."organizationId" = a."organizationId"
      );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Qr_set_qr_label_applied_at_on_assignment"
AFTER UPDATE OF "assetId" ON "Qr"
FOR EACH ROW
EXECUTE FUNCTION set_qr_label_applied_at_on_assignment();
