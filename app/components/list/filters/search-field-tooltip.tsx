import { useLoaderData } from "@remix-run/react";

export const SearchFieldTooltip = () => {
  const { searchFieldTooltip } = useLoaderData();
  return searchFieldTooltip ? (
    <span className="absolute right-[14px] top-[35px] flex h-6 w-[20px] cursor-pointer flex-col items-end justify-center text-gray-500">
      🖌️
    </span>
  ) : null;
};
