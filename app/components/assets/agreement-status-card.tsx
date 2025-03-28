import { CustodySignatureStatus } from "@prisma/client";
import type { SerializeFrom } from "@remix-run/node";
import { PenLineIcon } from "lucide-react";
import { type loader } from "~/routes/_layout+/assets.$assetId.overview";
import { resolveTeamMemberName } from "~/utils/user";
import { Button } from "../shared/button";
import { Card } from "../shared/card";

type AgreementStatusCardProps = {
  asset: SerializeFrom<typeof loader>["asset"];
};

export default function AgreementStatusCard({
  asset,
}: AgreementStatusCardProps) {
  if (!asset.custody) {
    return null;
  }

  return (
    <Card className="my-3 flex items-center gap-2">
      <div className="flex size-12 items-center justify-center rounded-full bg-gray-50">
        <div className="flex size-10 items-center justify-center rounded-full bg-gray-100 text-gray-700">
          <PenLineIcon className="size-4" />
        </div>
      </div>

      <div>
        <p className="font-semibold">
          {asset.custody.signatureStatus === CustodySignatureStatus.PENDING ? (
            <>
              Awaiting signature from{" "}
              {resolveTeamMemberName(asset.custody.custodian)}
            </>
          ) : (
            asset.custody?.agreement?.name
          )}
        </p>

        <Button to="share-agreement" variant="link-gray">
          Share document
        </Button>
      </div>
    </Card>
  );
}
