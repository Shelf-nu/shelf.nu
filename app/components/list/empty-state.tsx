import { useLoaderData } from "@remix-run/react";

import { ClearSearch } from "./filters/clear-search";
import { Button } from "../shared/button";

export const EmptyState = () => {
  const { search } = useLoaderData();

  const texts = {
    title: search ? "No items found" : "No Items on database",
    p: search
      ? `Your search for "${search}" did not \n match any items in the database.`
      : "What are you waiting for? Create your first item now!",
  };

  return (
    <div className="flex h-full flex-col justify-center gap-[32px] py-[150px] text-center">
      <div className="flex flex-col items-center">
        <img
          src="/images/empty-state.svg"
          alt="Empty state"
          className="h-auto w-[172px]"
        />

        <div className="text-text-lg font-semibold text-gray-900">
          {texts.title}
        </div>
        <p>{texts.p}</p>
      </div>
      <div className="flex justify-center gap-3">
        {search && (
          <ClearSearch
            buttonProps={{
              variant: "secondary",
            }}
          >
            Clear Search
          </ClearSearch>
        )}
        <Button to="new" aria-label="new item" icon="plus">
          New Item
        </Button>
      </div>
    </div>
  );
};
