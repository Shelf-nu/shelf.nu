import { Link } from "@remix-run/react";
import Icon from "../icons/icon";
import { CustomTooltip } from "../shared/custom-tooltip";

type AwaitingSignatureTooltipProps = {
  assetId: string;
};

export default function AwaitingSignatureTooltip({
  assetId,
}: AwaitingSignatureTooltipProps) {
  return (
    <CustomTooltip
      content={
        <div className="max-w-[260px] text-left sm:max-w-[320px]">
          <h6 className="mb-1 text-xs font-semibold text-gray-700">
            Awaiting signature to complete custody assignment
          </h6>
          <div className="whitespace-normal text-xs font-medium text-gray-500">
            Asset status will change after signing. To cancel custody
            assignment, go to{" "}
            <span className="font-semibold text-gray-600">
              {"Actions > Check in"}
            </span>
          </div>
        </div>
      }
    >
      <Link
        className="rounded-full bg-gray-200 p-1"
        to={`/assets/${assetId}/overview/share-agreement`}
      >
        <Icon icon="sign" />
      </Link>
    </CustomTooltip>
  );
}
