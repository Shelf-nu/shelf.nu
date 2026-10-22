/**
 * Form Row Errors
 *
 * Lists a single-row form's field errors underneath the whole row. Inputs in a
 * bottom-aligned row (`lg:items-end`) cannot carry their own error text: the
 * text grows that one field and pushes its input out of line with the rest.
 * Such inputs pass `hideErrorText` (they keep the red outline) and point
 * `aria-describedby` at this component's `id`.
 *
 * @see {@link file://./../category/new-category-form.tsx}
 * @see {@link file://./../../routes/_layout+/tags.new.tsx}
 */

/** Props for {@link FormRowErrors} */
type FormRowErrorsProps = {
  /** Id the inputs reference through `aria-describedby` */
  id: string;
  /** One entry per field; empty entries (no error) are skipped */
  errors: (string | null | undefined)[];
  className?: string;
};

/**
 * Renders the non-empty error messages, one per line, or nothing when there
 * are none.
 */
export function FormRowErrors({ id, errors, className }: FormRowErrorsProps) {
  const messages = errors.filter((message): message is string => !!message);
  if (messages.length === 0) {
    return null;
  }

  return (
    <div id={id} className={className ?? "mt-3 text-sm text-error-500"}>
      {messages.map((message) => (
        <p key={message}>{message}</p>
      ))}
    </div>
  );
}
