import type { Tag } from "@prisma/client";
import { useLoaderData } from "react-router";
import FormRow from "~/components/forms/form-row";
import MultiSelect from "~/components/multi-select/multi-select";
import { tw } from "~/utils/tw";

type TagFieldProps = {
  className?: string;
  existingTags: Pick<Tag, "id" | "name">[];
  disabled?: boolean;
  required?: boolean;
  error?: string;
};

export default function TagField({
  className,
  existingTags,
  disabled,
  required = false,
  error,
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
      <MultiSelect
        className="w-full"
        label="Tags"
        items={tagsSuggestions}
        defaultSelected={existingTags.map((tag) => ({
          label: tag.name,
          value: tag.id,
        }))}
        labelKey="label"
        valueKey="value"
        name="tags"
        disabled={disabled}
        required={required}
        error={error}
      />
    </FormRow>
  );
}
