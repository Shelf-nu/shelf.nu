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
  onInputChange,
  noOptionsText,
}: {
  existingTags: Tag[];
  suggestions: TagSuggestion[];
  disabled?: boolean;
  hideLabel?: boolean;
  error?: string;
  required?: boolean;
  /** Called with the typed text, to search the server. See `useTagSuggestions`. */
  onInputChange?: (value: string) => void;
  /** Text shown when no suggestion matches, e.g. while a search runs. */
  noOptionsText?: string;
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
    onInputChange={onInputChange}
    noOptionsText={noOptionsText}
  />
);
