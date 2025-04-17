import type { User } from "@prisma/client";
import { PenLineIcon } from "lucide-react";
import { tw } from "~/utils/tw";
import { resolveTeamMemberName } from "~/utils/user";
import { Button } from "../shared/button";
import { Card } from "../shared/card";

type AgreementStatusCardProps = {
  className?: string;
  receiptId: string | null;
  isSignaturePending: boolean;
  custodian: {
    name: string;
    user?: Partial<Pick<User, "firstName" | "lastName" | "email">> | null;
  };
  agreementName: string;
};

export default function AgreementStatusCard({
  className,
  receiptId,
  isSignaturePending,
  custodian,
  agreementName,
}: AgreementStatusCardProps) {
  return (
    <Card className={tw("my-3 flex items-center gap-2", className)}>
      <div className="flex size-12 items-center justify-center rounded-full bg-gray-50">
        <div className="flex size-10 items-center justify-center rounded-full bg-gray-100 text-gray-700">
          <PenLineIcon className="size-4" />
        </div>
      </div>

      <div>
        <p className="font-semibold">
          {isSignaturePending ? (
            <>Awaiting signature from {resolveTeamMemberName(custodian)}</>
          ) : (
            agreementName
          )}
        </p>

        <Button
          to={
            isSignaturePending
              ? "share-agreement"
              : `/receipts?receiptId=${receiptId}`
          }
          variant="link-gray"
        >
          {isSignaturePending ? "Share document" : "View receipt"}
        </Button>
      </div>
    </Card>
  );
}
