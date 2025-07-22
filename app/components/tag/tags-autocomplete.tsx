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
  error,
  required = false,
}: {
  existingTags: Tag[];
  suggestions: TagSuggestion[];
  disabled?: boolean;
  hideLabel?: boolean;
  error?: string;
  required?: boolean;
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
    error={error}
    required={required}
  />
);
