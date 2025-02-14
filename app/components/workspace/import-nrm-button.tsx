import { UpgradeMessage } from "../marketing/upgrade-message";
import { Button } from "../shared/button";

export const ImportNrmButton = ({
  canImportNRM,
}: {
  canImportNRM: boolean;
}) => (
  <Button
    to={`import-members`}
    variant="secondary"
    role="link"
    className="whitespace-nowrap"
    disabled={
      !canImportNRM
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
    title="Import"
  >
    Import NRM
  </Button>
);
