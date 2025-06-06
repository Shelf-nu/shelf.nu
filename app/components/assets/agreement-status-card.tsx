import type { Kit, User } from "@prisma/client";
import { PenLineIcon } from "lucide-react";
import { useUserData } from "~/hooks/use-user-data";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
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
  kit?: Pick<Kit, "id" | "name">;
  signUrl: string;
};

export default function AgreementStatusCard({
  className,
  receiptId,
  isSignaturePending,
  custodian,
  agreementName,
  kit,
  signUrl,
}: AgreementStatusCardProps) {
  const user = useUserData();
  const { isBaseOrSelfService } = useUserRoleHelper();

  const isCustodianCurrentUser = custodian?.user?.email === user?.email;

  function getUrl() {
    if (isSignaturePending) {
      if (isCustodianCurrentUser) {
        return signUrl;
      }

      return kit ? "assets/share-agreement" : "share-agreement";
    }

    return `/receipts?receiptId=${receiptId}`;
  }

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
            <>
              Awaiting signature from{" "}
              {isCustodianCurrentUser
                ? "you"
                : resolveTeamMemberName(custodian)}
            </>
          ) : (
            agreementName
          )}
        </p>

        {kit ? (
          <p className="mb-1 font-semibold">
            Custody assigned via{" "}
            <Button to={`/kits/${kit.id}`} target="_blank" variant="link-gray">
              {kit.name}
            </Button>
          </p>
        ) : null}

        {isSignaturePending &&
        isBaseOrSelfService &&
        !isCustodianCurrentUser ? null : (
          <Button to={getUrl()} variant="link-gray">
            {isSignaturePending
              ? isCustodianCurrentUser
                ? "Sign document"
                : "Share document"
              : "View receipt"}
          </Button>
        )}
      </div>
    </Card>
  );
}
