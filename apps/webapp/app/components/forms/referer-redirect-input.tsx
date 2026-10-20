import { useState } from "react";

interface RefererRedirectInputProps {
  /**
   * The name of the form field.
   * This should match the field name in your form schema.
   */
  fieldName: string;

  /**
   * The referer path (pathname + search) to redirect back to.
   * Typically obtained from `getRefererPath(request)` in your loader.
   * Example: "/assets?search=laptop&status=AVAILABLE"
   *
   * Only the value at mount is used; later changes are ignored.
   */
  referer?: string | null;
}

/**
 * Hidden input component that handles redirecting users back to the previous page
 * after form submission, preserving their search/filter context.
 *
 * Features:
 * - Preserves search params (e.g., /assets?search=laptop returns to filtered view)
 * - Automatically detects if page was opened in a new tab (cmd+click/ctrl+click)
 * - If opened in new tab, clears the redirect value so the form action uses its fallback
 * - Works seamlessly with Remix form actions and `safeRedirect`
 * - Posts the referer it mounted with. The Referer header is only meaningful
 *   when the user arrives: a navigation that stays on the form's route (an
 *   asset form adding `?category=<id>`) re-runs the loader with this page as
 *   the Referer, and following that would lose where the user came from.
 *
 * @example
 * ```tsx
 * // In your route loader
 * const referer = getRefererPath(request);
 * return payload({ referer, ...otherData });
 * // referer might be: "/assets?search=laptop&status=AVAILABLE"
 *
 * // In your form component
 * <Form method="post">
 *   <RefererRedirectInput fieldName="redirectTo" referer={referer} />
 *   {/* other form fields *\/}
 * </Form>
 *
 * // In your route action
 * const { redirectTo } = payload;
 * if (redirectTo) {
 *   return redirect(safeRedirect(redirectTo, fallbackPath));
 * }
 * return payload({ success: true }); // Stay on page
 * ```
 */
export function RefererRedirectInput({
  fieldName,
  referer,
}: RefererRedirectInputProps) {
  // Snapshot on mount on purpose, not a stale-prop bug: see the JSDoc above.
  const [initialReferer] = useState(referer);

  if (!initialReferer) {
    return null;
  }

  return (
    <input
      type="hidden"
      name={fieldName}
      defaultValue={initialReferer}
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
