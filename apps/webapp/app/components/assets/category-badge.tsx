import type { Category } from "@prisma/client";
import { AssetsFilterLink } from "./assets-filter-link";
import { Badge } from "../shared/badge";

/**
 * Category of an asset or kit as a colored badge.
 *
 * With `linkToAssets`, the badge opens the asset index filtered to that
 * category (`Uncategorized` opens the assets without one). Viewers who may not
 * read assets get the plain badge.
 *
 * Leave it off wherever a link cannot work or would mislead: pickers whose
 * rows toggle a selection, kit categories, PDFs and anything rendered outside
 * the router.
 */
export function CategoryBadge({
  category,
  className,
  linkToAssets = false,
}: {
  category: Pick<Category, "id" | "name" | "color"> | null;
  className?: string;
  /** Link the badge to `/assets?category=<id>` */
  linkToAssets?: boolean;
}) {
  const badge = category ? (
    <Badge color={category.color} withDot={false} className={className}>
      {category.name}
    </Badge>
  ) : (
    <Badge color="#575757" withDot={false} className={className}>
      Uncategorized
    </Badge>
  );

  if (!linkToAssets) {
    return badge;
  }

  return (
    <AssetsFilterLink
      filter={{ category: category?.id ?? "uncategorized" }}
      title={
        category
          ? `View assets in ${category.name}`
          : "View assets without a category"
      }
    >
      {badge}
    </AssetsFilterLink>
  );
}
