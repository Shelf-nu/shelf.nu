import { UpgradeMessage } from "../marketing/upgrade-message";
import { Button } from "../shared/button";

export const ImportButton = ({
  canImportAssets,
}: {
  canImportAssets: boolean;
}) => (
  <Button
    to={`import`}
    variant="secondary"
    role="link"
    disabled={
      !canImportAssets
        ? {
            reason: (
              <>
                Importing is not available on the free tier of shelf.{" "}
                <UpgradeMessage />
              </>
            ),
          }
        : false
    }
    title="Import assets"
  >
    Import
  </Button>
);
