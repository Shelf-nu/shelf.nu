import { useCallback, useEffect, useState } from "react";
import type { Tag as ShelfTag } from "@prisma/client";
import { useLoaderData } from "@remix-run/react";
import type { Tag } from "react-tag-autocomplete";
import { ReactTags } from "react-tag-autocomplete";

export interface Suggestion {
  label: string;
  value: string;
}

export const TagsAutocomplete = ({ existingTags }: { existingTags: Tag[] }) => {
  /** Get the tags from the loader */

  const suggestions = useLoaderData().tags.map((tag: ShelfTag) => ({
    label: tag.name,
    value: tag.id,
  }));

  const [selected, setSelected] = useState<Tag[]>([]);

  useEffect(() => {
    setSelected(() => [...existingTags]);
  }, [existingTags]);

  const onAdd = useCallback(
    (newTag: Tag) => {
      setSelected([...selected, newTag]);
    },
    [selected]
  );

  const onDelete = useCallback(
    (tagIndex: number) => {
      setSelected(selected.filter((_, i) => i !== tagIndex));
    },
    [selected]
  );

  return (
    <>
      <input
        type="hidden"
        name="tags"
        value={selected.map((tag) => tag.value).join(",")}
      />
      <ReactTags
        labelText="Select tags"
        selected={selected}
        suggestions={suggestions}
        onAdd={onAdd}
        onDelete={onDelete}
        noOptionsText="No matching tags"
      />
    </>
  );
};
