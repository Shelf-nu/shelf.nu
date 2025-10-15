interface RefererRedirectInputProps {
  /**
   * The name of the form field.
   * This should match the field name in your form schema.
   */
  fieldName: string;

  /**
   * The referer path to redirect back to.
   * Typically obtained from `getRefererPath(request)` in your loader.
   */
  referer?: string | null;
}

/**
 * Hidden input component that handles redirecting users back to the previous page
 * after form submission.
 *
 * Features:
 * - Automatically detects if page was opened in a new tab (cmd+click/ctrl+click)
 * - If opened in new tab, clears the redirect value so the form action uses its fallback
 * - Works seamlessly with Remix form actions and `safeRedirect`
 *
 * @example
 * ```tsx
 * // In your route loader
 * const referer = getRefererPath(request);
 * return json(data({ referer, ...otherData }));
 *
 * // In your form component
 * <Form method="post">
 *   <RefererRedirectInput fieldName="redirectTo" referer={referer} />
 *   {/* other form fields *\/}
 * </Form>
 *
 * // In your route action
 * const { redirectTo } = payload;
 * return redirect(safeRedirect(redirectTo, fallbackPath));
 * ```
 */
export function RefererRedirectInput({
  fieldName,
  referer,
}: RefererRedirectInputProps) {
  if (!referer) {
    return null;
  }

  return (
    <input
      type="hidden"
      name={fieldName}
      defaultValue={referer}
      ref={(input) => {
        // Don't redirect back if page was opened in a new tab
        // (e.g., via cmd+click or ctrl+click)
        if (input && typeof window !== "undefined") {
          if (window.history.length === 1) {
            input.value = "";
          }
        }
      }}
    />
  );
}
