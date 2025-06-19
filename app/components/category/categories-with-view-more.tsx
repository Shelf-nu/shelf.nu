import React from "react";
import type { Category } from "@prisma/client";
import { tw } from "~/utils/tw";
import { CategoryBadge } from "../assets/category-badge";
import { GrayBadge } from "../shared/gray-badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../shared/tooltip";

export const CategoriesWithViewMore = ({
  showCount = 2,
  categories,
  className,
  emptyState = "No categories",
}: {
  showCount?: number;
  categories: Pick<Category, "id" | "name" | "color">[] | undefined;
  emptyState?: string | React.ReactNode;
  className?: string;
}) => {
  // Filter out any null/undefined categories first
  const filteredCategories = categories?.filter(Boolean) || [];

  // Show only the first 3 categories
  const visibleCategories = filteredCategories.slice(0, showCount);
  const remainingCategories = filteredCategories.slice(showCount);

  return filteredCategories.length > 0 ? (
    <div className={tw("text-right", className)}>
      {visibleCategories.map((category) => (
        <CategoryBadge
          category={category}
          className="mb-2 mr-2"
          key={category.id}
        />
      ))}
      {remainingCategories.length > 0 ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>
              <GrayBadge className="ml-2">{`+${
                filteredCategories.length - showCount
              }`}</GrayBadge>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-72">
              {remainingCategories.map((category) => (
                <CategoryBadge
                  category={category}
                  key={category.id}
                  className="mb-2 mr-2"
                />
              ))}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : null}
    </div>
  ) : (
    <div>{emptyState}</div>
  );
};
