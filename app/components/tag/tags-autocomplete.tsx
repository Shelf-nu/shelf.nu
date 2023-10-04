import React, { useCallback, useEffect, useState } from "react";
import { useLoaderData } from "@remix-run/react";
import type { Tag } from "react-tag-autocomplete";
import { ReactTags } from "react-tag-autocomplete";
import type { loader } from "~/routes/_layout+/assets.$assetId_.edit";

export interface Suggestion {
  label: string;
  value: string;
}

export const TagsAutocomplete = ({ existingTags }: { existingTags: Tag[] }) => {
  /* This is a workaround for the SSR issue with react-tag-autocomplete */
  if (typeof document === "undefined") {
    React.useLayoutEffect = React.useEffect;
  }

  /** Get the tags from the loader */

  const suggestions = useLoaderData<typeof loader>().tags.map((tag) => ({
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
