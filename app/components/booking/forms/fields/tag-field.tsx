import type { Tag } from "@prisma/client";
import { useLoaderData } from "@remix-run/react";
import FormRow from "~/components/forms/form-row";
import { InnerLabel } from "~/components/forms/inner-label";
import { TagsAutocomplete } from "~/components/tag/tags-autocomplete";
import { tw } from "~/utils/tw";

type TagFieldProps = {
  className?: string;
  existingTags: Pick<Tag, "id" | "name">[];
  disabled?: boolean;
};

export default function TagField({
  className,
  existingTags,
  disabled,
}: TagFieldProps) {
  const { tags } = useLoaderData<{ tags: Tag[] }>();

  const tagsSuggestions = tags.map((tag) => ({
    label: tag.name,
    value: tag.id,
  }));

  return (
    <FormRow
      rowLabel="Tags"
      className={tw("mobile-styling-only border-b-0 p-0", className)}
    >
      <InnerLabel>Tags</InnerLabel>

      <TagsAutocomplete
        disabled={disabled}
        existingTags={existingTags.map((tag) => ({
          label: tag.name,
          value: tag.id,
        }))}
        suggestions={tagsSuggestions}
      />
    </FormRow>
  );
}
