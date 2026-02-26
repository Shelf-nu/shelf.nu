import type { Tag } from "@prisma/client";
import ItemsWithViewMore from "~/components/list/items-with-view-more";
import { EmptyTableValue } from "~/components/shared/empty-table-value";
import { Tag as TagBadge } from "~/components/shared/tag";

export const ListItemTagsColumn = ({
  tags,
}: {
  tags: Pick<Tag, "id" | "name" | "color">[] | undefined;
}) => {
  if (!tags || tags.length === 0) {
    return <EmptyTableValue />;
  }

  return (
    <ItemsWithViewMore
      items={tags}
      showCount={2}
      className="justify-start text-left"
      renderItem={(tag) => (
        <TagBadge key={tag.id} color={tag.color ?? undefined} withDot={false}>
          {tag.name}
        </TagBadge>
      )}
      emptyMessage={null}
    />
  );
};
