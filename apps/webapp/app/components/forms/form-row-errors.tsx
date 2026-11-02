/**
 * Form Row Errors
 *
 * Lists a single-row form's field errors underneath the whole row. Inputs in a
 * bottom-aligned row (`lg:items-end`) cannot carry their own error text: the
 * text grows that one field and pushes its input out of line with the rest.
 * Such inputs pass `hideErrorText` (they keep the red outline) and point
 * `aria-describedby` at their own message via {@link rowErrorId}, so a screen
 * reader announces only that field's error.
 *
 * @see {@link file://./../category/new-category-form.tsx}
 * @see {@link file://./../../routes/_layout+/tags.new.tsx}
 */

/**
 * Id of one field's message inside a {@link FormRowErrors} list. Inputs pass it
 * to `aria-describedby` while that field has an error.
 *
 * @param id - The `id` given to `FormRowErrors`
 * @param field - The field's key in the `errors` map
 * @returns The message element's id
 */
export function rowErrorId(id: string, field: string) {
  return `${id}-${field}`;
}

/** Props for {@link FormRowErrors} */
type FormRowErrorsProps = {
  /** Base id; each message's id is `rowErrorId(id, field)` */
  id: string;
  /** Error per field, in display order; empty entries (no error) are skipped */
  errors: Record<string, string | null | undefined>;
  className?: string;
};

/**
 * Renders the non-empty error messages, one per line, or nothing when there
 * are none.
 */
export function FormRowErrors({ id, errors, className }: FormRowErrorsProps) {
  const entries = Object.entries(errors).filter(
    (entry): entry is [string, string] => !!entry[1]
  );
  if (entries.length === 0) {
    return null;
  }

  return (
    <div className={className ?? "mt-3 text-sm text-error-500"}>
      {entries.map(([field, message]) => (
        <p key={field} id={rowErrorId(id, field)}>
          {message}
        </p>
      ))}
    </div>
  );
}
