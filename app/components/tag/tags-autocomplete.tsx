import type { Tag } from "react-tag-autocomplete";
import MultiSelect from "../multi-select/multi-select";

export interface TagSuggestion {
  label: string;
  value: string;
}

export const TagsAutocomplete = ({
  existingTags,
  suggestions,
  disabled = false,
  hideLabel = false,
}: {
  existingTags: Tag[];
  suggestions: TagSuggestion[];
  disabled?: boolean;
  hideLabel?: boolean;
}) => (
  <MultiSelect
    className="w-full"
    label="Tags"
    items={suggestions}
    defaultSelected={existingTags}
    labelKey="label"
    valueKey="value"
    name="tags"
    disabled={disabled}
    hideLabel={hideLabel}
  />
);
