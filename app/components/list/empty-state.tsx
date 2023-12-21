import { useLoaderData } from "@remix-run/react";

import type { SearchableIndexResponse } from "~/modules/types";
import { ClearSearch } from "./filters/clear-search";
import { Button } from "../shared/button";
export interface CustomEmptyState {
  customContent?: {
    title: string;
    text: string;
    newButtonRoute: string;
    newButtonContent: string;
    buttonProps?: any;
  };
  modelName?: {
    singular: string;
    plural: string;
  };
}
export const EmptyState = ({ customContent, modelName }: CustomEmptyState) => {
  const { search, modelName: modelNameData } =
    useLoaderData<SearchableIndexResponse>();
  const singular = modelName?.singular || modelNameData.singular;
  const plural = modelName?.plural || modelNameData.plural;

  const texts = {
    title: search ? `No ${plural} found` : `No ${plural} on database`,
    p: search
      ? `Your search for "${search}" did not \n match any ${plural} in the database.`
      : `What are you waiting for? Create your first ${singular} now!`,
  };

  return (
    <div className="flex h-full flex-col justify-center gap-[32px] py-[100px] text-center">
      <div className="flex flex-col items-center">
        <img
          src="/images/empty-state.svg"
          alt="Empty state"
          className="h-auto w-[172px]"
        />
        {customContent ? (
          <div>
            <div className="text-text-lg font-semibold text-gray-900">
              {customContent.title}
            </div>
            <p>{customContent.text}</p>
          </div>
        ) : (
          <div>
            <div className="text-text-lg font-semibold text-gray-900">
              {texts.title}
            </div>
            <p>{texts.p}</p>
          </div>
        )}
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
        <Button
          to={
            customContent?.newButtonRoute ? customContent.newButtonRoute : "new"
          }
          aria-label={`new ${singular}`}
          icon="plus"
          {...(customContent?.buttonProps || undefined)}
        >
          {customContent?.newButtonContent
            ? customContent.newButtonContent
            : `New ${singular}`}
        </Button>
      </div>
    </div>
  );
};
