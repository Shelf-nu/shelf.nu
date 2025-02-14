import React, { useCallback, useEffect, useState } from "react";
import type { Tag } from "react-tag-autocomplete";
import { ReactTags } from "react-tag-autocomplete";

export interface TagSuggestion {
  label: string;
  value: string;
}

export const TagsAutocomplete = ({
  existingTags,
  suggestions,
}: {
  existingTags: Tag[];
  suggestions: TagSuggestion[];
}) => {
  /* This is a workaround for the SSR issue with react-tag-autocomplete */
  if (typeof document === "undefined") {
    React.useLayoutEffect = React.useEffect;
  }
  const [selected, setSelected] = useState<Tag[]>([]);

  useEffect(() => {
    if (existingTags && existingTags.length > 0)
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
