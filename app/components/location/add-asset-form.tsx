import type { Asset } from "@prisma/client";
import { useAtom } from "jotai";
import { bookingsSelectedAssetsAtom } from "~/atoms/booking-selected-assets-atom";

export const AddAssetForm = ({
  assetId,
  isChecked,
}: {
  assetId: Asset["id"];
  isChecked: boolean;
}) => {
  const [selectedAssets, setSelectedAssets] = useAtom(
    bookingsSelectedAssetsAtom
  );
  const atomIsChecked =
    isChecked || selectedAssets.some((id) => id === assetId);

  function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    setSelectedAssets((selectedAssets) => {
      if (selectedAssets.includes(assetId)) {
        return selectedAssets.filter((id) => id !== assetId);
      } else {
        return [...selectedAssets, assetId];
      }
    });
  }

  return (
    <button type="submit" onClick={handleClick}>
      <FakeCheckbox checked={atomIsChecked} />
    </button>
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
        stroke="#EF6820"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="0.5" y="0.5" width="19" height="19" rx="5.5" stroke="#EF6820" />
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
