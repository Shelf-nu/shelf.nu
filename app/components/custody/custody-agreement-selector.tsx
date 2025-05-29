import { useState } from "react";
import type { CustodyAgreement } from "@prisma/client";
import { Link } from "@remix-run/react";
import useApiQuery from "~/hooks/use-api-query";
import { tw } from "~/utils/tw";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../forms/select";
import { Switch } from "../forms/switch";
import { Button } from "../shared/button";
import { CustomTooltip } from "../shared/custom-tooltip";
import When from "../when/when";

type CustodyAgreementSelectorProps = {
  className?: string;
  hasCustodianSelected: boolean;
  disabled?: boolean;
};

export default function CustodyAgreementSelector({
  className,
  hasCustodianSelected,
  disabled,
}: CustodyAgreementSelectorProps) {
  const [addAgreementEnabled, setAddAgreementEnabled] = useState(false);
  const [selectedAgreement, setSelectedAgreement] =
    useState<CustodyAgreement>();

  const { isLoading, data } = useApiQuery<{ agreements: CustodyAgreement[] }>({
    api: "/api/custody-agreements",
    enabled: addAgreementEnabled,
  });

  const agreements = data?.agreements;

  if (!hasCustodianSelected) {
    return (
      <div className={tw("flex gap-x-2", className)}>
        <CustomTooltip
          content={
            <TooltipContent
              title="Please select a custodian"
              message="You need to select a custodian before you can add a PDF agreement."
            />
          }
        >
          <Switch required={false} disabled={!hasCustodianSelected} />
        </CustomTooltip>
        <PdfSwitchLabel hasAgreements={!!agreements?.length} />
      </div>
    );
  }

  return (
    <div className={tw("w-full", className)}>
      <div className="mb-5 flex gap-x-2">
        <Switch
          onClick={() => setAddAgreementEnabled((prev) => !prev)}
          defaultChecked={addAgreementEnabled}
          required={false}
          disabled={disabled}
        />
        <input
          type="hidden"
          name="addAgreementEnabled"
          value={addAgreementEnabled.toString()}
        />
        <PdfSwitchLabel hasAgreements={!!agreements?.length} />
      </div>

      <When truthy={addAgreementEnabled}>
        <Select
          name="agreement"
          disabled={isLoading}
          onValueChange={(value) => {
            setSelectedAgreement(agreements?.find((a) => a.id === value));
          }}
        >
          <SelectTrigger className="text-left">
            <SelectValue placeholder="Select a PDF agreement" />
          </SelectTrigger>

          <SelectContent
            className="w-[352px]"
            position="popper"
            align="start"
            ref={(ref) =>
              ref?.addEventListener("touchend", (e) => e.preventDefault())
            }
          >
            <When
              truthy={!!agreements?.length}
              fallback={
                <div>
                  No agreements found.{" "}
                  <Button to="/agreements/new" variant="link">
                    Create new agreement
                  </Button>
                </div>
              }
            >
              <div className="max-h-[320px] overflow-auto">
                {agreements?.map((agreement) => (
                  <SelectItem
                    key={agreement.id}
                    value={agreement.id}
                    className="flex cursor-pointer select-none items-center justify-between gap-4 px-6 py-4 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-gray-100 focus:bg-gray-100"
                  >
                    {agreement.name}{" "}
                    {!agreement.signatureRequired ? (
                      <span className="text-xs font-normal text-gray-500">
                        (view only)
                      </span>
                    ) : (
                      ""
                    )}
                  </SelectItem>
                ))}
              </div>
            </When>
          </SelectContent>
        </Select>

        {selectedAgreement && !selectedAgreement?.signatureRequired ? (
          <p className="mt-1 text-sm text-warning-400">
            Selected custody agreement does not require a signature. The
            agreement will directly go in custody.
          </p>
        ) : null}

        <Link
          target="_blank"
          className="mt-2 block text-sm text-gray-800 underline"
          to="/agreements"
        >
          Manage PDF agreements
        </Link>
      </When>
    </div>
  );
}

export function TooltipContent({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <div>
      <div>
        <div className="text-md mb-2 font-semibold text-gray-700">{title}</div>
        <div className="text-sm text-gray-500">{message}</div>
      </div>
    </div>
  );
}

function PdfSwitchLabel({ hasAgreements }: { hasAgreements: boolean }) {
  return (
    <div className="flex flex-col gap-y-1">
      <div className="text-md font-semibold text-gray-600">
        Add PDF Agreement
      </div>
      <p className="text-sm text-gray-500">
        {hasAgreements
          ? "Custodian needs to read (and sign) a document before receiving custody. "
          : "You need to create an agreement before you can add them here. "}
        {hasAgreements ? (
          <Link
            target="_blank"
            className="text-gray-700 underline"
            to="https://www.shelf.nu/knowledge-base/understanding-and-using-pdf-agreements-for-asset-custody-in-shelf"
          >
            Learn more
          </Link>
        ) : (
          <Link
            target="_blank"
            className="text-gray-700 underline"
            to="/agreements/new"
          >
            Create an agreement
          </Link>
        )}
      </p>
    </div>
  );
}
