import { Button } from "../shared";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "../shared/hover-card";

export const ImportButton = ({
  canImportAssets,
}: {
  canImportAssets: boolean;
}) =>
  canImportAssets ? (
    <Button to="/import" variant="link" role="link">
      Import
    </Button>
  ) : (
    <HoverCard>
      <HoverCardTrigger className="disabled inline-flex cursor-not-allowed items-center justify-center border-none p-0 text-text-sm font-semibold text-primary-700 hover:text-primary-800">
        Import
      </HoverCardTrigger>
      <HoverCardContent>
        <p>
          Importing is not available on the free tier of shelf. Please{" "}
          <Button to="/settings/subscription" variant="link">
            upgrade to a paid plan
          </Button>
          .
        </p>
      </HoverCardContent>
    </HoverCard>
  );
