import type { Tag } from "@prisma/client";
import ItemsWithViewMore from "~/components/list/items-with-view-more";
import { EmptyTableValue } from "~/components/shared/empty-table-value";
import { Tag as TagBadge } from "~/components/shared/tag";
import { AssetsFilterLink } from "../assets-filter-link";

/**
 * Tags of an asset in a list row: the first two, then a "+N" chip listing the
 * rest on hover.
 *
 * With `linkToAssets`, each tag (in the row and in the "+N" popover) opens
 * the asset index filtered to that tag. Leave it off in pickers whose rows toggle
 * a selection.
 */
export const ListItemTagsColumn = ({
  tags,
  linkToAssets = false,
}: {
  tags: Pick<Tag, "id" | "name" | "color">[] | undefined;
  /** Link each tag to `/assets?tag=<id>` */
  linkToAssets?: boolean;
}) => {
  if (!tags || tags.length === 0) {
    return <EmptyTableValue />;
  }

  return (
    <ItemsWithViewMore
      items={tags}
      showCount={2}
      className="justify-start text-left"
      interactive={linkToAssets}
      renderItem={(tag) =>
        linkToAssets ? (
          <AssetsFilterLink
            key={tag.id}
            filter={{ tag: tag.id }}
            title={`View assets tagged ${tag.name}`}
          >
            <TagBadge color={tag.color ?? undefined} withDot={false}>
              {tag.name}
            </TagBadge>
          </AssetsFilterLink>
        ) : (
          <TagBadge key={tag.id} color={tag.color ?? undefined} withDot={false}>
            {tag.name}
          </TagBadge>
        )
      }
      emptyMessage={null}
    />
  );
};
