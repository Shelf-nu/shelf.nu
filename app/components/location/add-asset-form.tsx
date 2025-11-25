import type { Asset } from "@prisma/client";
import { useFetcher } from "react-router";

export const AddAssetForm = ({
  assetId,
  isChecked,
}: {
  assetId: Asset["id"];
  isChecked: boolean;
}) => {
  const fetcher = useFetcher();
  let optimisticIsChecked = isChecked;
  if (fetcher.formData) {
    optimisticIsChecked = fetcher.formData.get("isChecked") === "yes";
  }

  return (
    <fetcher.Form method="post">
      <input type="hidden" name="assetId" value={assetId} />
      <input
        type="hidden"
        name="isChecked"
        value={optimisticIsChecked ? "no" : "yes"}
      />
      <button type="submit" className="text-primary">
        <FakeCheckbox checked={optimisticIsChecked} />
      </button>
    </fetcher.Form>
  );
};

const FakeCheckbox = ({ checked }: { checked: boolean }) =>
  checked ? (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="0.5" y="0.5" width="19" height="19" rx="5.5" fill="#FEF6EE" />
      <path
        d="M14.6668 6.5L8.25016 12.9167L5.3335 10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect
        x="0.5"
        y="0.5"
        width="19"
        height="19"
        rx="5.5"
        stroke="currentColor"
      />
    </svg>
  ) : (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="0.5" y="0.5" width="19" height="19" rx="5.5" fill="white" />
      <rect x="0.5" y="0.5" width="19" height="19" rx="5.5" stroke="#D0D5DD" />
    </svg>
  );
