/**
 * InlineEditableField — a reusable wrapper that toggles between
 * a read-only display and an inline editor for a single field.
 *
 * Used on the asset overview page so users can edit fields without
 * navigating to the full edit form.
 *
 * @see {@link file://./../../routes/_layout+/assets.$assetId.overview.tsx}
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type { FetcherWithComponents } from "react-router";
import { useFetcher } from "react-router";
import { useDisabled } from "~/hooks/use-disabled";
import { tw } from "~/utils/tw";
import { Button } from "./button";
import Icon from "../icons/icon";

/** Props for the InlineEditableField component */
type InlineEditableFieldProps = {
  /** The field name sent as a hidden input to identify which field is being updated */
  fieldName: string;
  /** The label displayed on the left side of the row */
  label: string;
  /** Whether the current user has permission to edit this field */
  canEdit: boolean;
  /** Renders the read-only display value */
  renderDisplay: () => ReactNode;
  /** Renders the editor input; receives the fetcher and a cancel callback */
  renderEditor: (props: {
    fetcher: FetcherWithComponents<any>;
    onCancel: () => void;
  }) => ReactNode;
  /** Additional class names for the outer `<li>` element */
  className?: string;
  /** Extra hidden inputs to include in the form (e.g., customFieldId) */
  extraHiddenInputs?: Record<string, string>;
  /**
   * Whether the field currently has no value. When true AND the user cannot
   * edit, the field is hidden entirely (preserves original view-user UX).
   * When true AND the user can edit, the field renders with the placeholder
   * from `renderDisplay` so the user can click to add a value.
   */
  isEmpty?: boolean;
};

/**
 * Wraps a single field on the asset overview page, enabling click-to-edit.
 *
 * In display mode, hovering shows a pencil icon (if the user has edit permission).
 * Clicking the pencil (or the value area) enters edit mode, which renders the
 * provided editor inside a fetcher form. Save/Cancel buttons and Escape key
 * handling are built in.
 *
 * @param props - Component props
 */
export function InlineEditableField({
  fieldName,
  label,
  canEdit,
  renderDisplay,
  renderEditor,
  className,
  extraHiddenInputs,
  isEmpty,
}: InlineEditableFieldProps) {
  const [isEditing, setIsEditing] = useState(false);
  const fetcher = useFetcher<any>({ key: `inline-edit-${fieldName}` });
  const disabled = useDisabled(fetcher);
  const formRef = useRef<HTMLFormElement>(null);
  /** Track if a server error has been "acknowledged" (cleared on re-open) */
  const [showError, setShowError] = useState(true);

  /** Exit edit mode on successful submission */
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data?.error) {
      setIsEditing(false);
    }
  }, [fetcher.state, fetcher.data]);

  /**
   * Auto-focus the first editable control when entering edit mode.
   *
   * Matches: text/textarea/select inputs, combobox-role elements, AND
   * popover trigger buttons that carry `aria-haspopup` or `aria-expanded`
   * attributes (these are how DynamicSelect and LocationSelect render
   * their dropdown triggers — they are buttons, not inputs).
   *
   * Save/Cancel buttons do not carry these aria attributes, so they will
   * not be matched ahead of the actual editor control.
   */
  useEffect(() => {
    if (!isEditing) return;
    const form = formRef.current;
    if (!form) return;
    const firstInput = form.querySelector<HTMLElement>(
      [
        'input:not([type="hidden"]):not([disabled])',
        "textarea:not([disabled])",
        "select:not([disabled])",
        '[role="combobox"]',
        "button[aria-haspopup]:not([disabled])",
        "button[aria-expanded]:not([disabled])",
      ].join(", ")
    );
    firstInput?.focus();
  }, [isEditing]);

  const handleEnterEdit = useCallback(() => {
    setShowError(false);
    setIsEditing(true);
  }, []);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
  }, []);

  /**
   * Handle Escape key to cancel editing (only when not currently saving).
   *
   * Important exception: when Escape is pressed inside an open combobox
   * (e.g. the react-tags autocomplete listbox), the combobox should
   * handle it first to close just the listbox — NOT bubble up and cancel
   * the entire inline editor (which would discard the user's selections).
   */
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== "Escape" || disabled) return;

      const target = e.target as HTMLElement | null;
      const isCompositeEditorControl =
        target?.getAttribute("role") === "combobox" ||
        target?.matches("button[aria-haspopup], button[aria-expanded]");

      if (
        isCompositeEditorControl &&
        target?.getAttribute("aria-expanded") === "true"
      ) {
        // Let the editor control close its own popup first.
        return;
      }

      e.preventDefault();
      handleCancel();
    },
    [handleCancel, disabled]
  );

  /** When form is submitted, surface errors again */
  const handleSubmit = useCallback(() => {
    setShowError(true);
  }, []);

  const errorMessage =
    showError && fetcher.data?.error?.message
      ? fetcher.data.error.message
      : null;

  /** Hide entirely when there's no value AND user can't edit */
  if (isEmpty && !canEdit) return null;

  return (
    <li
      className={tw(
        "group/field w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex",
        className
      )}
    >
      <span className="w-1/4 text-[14px] font-medium text-gray-900">
        {label}
      </span>

      {isEditing ? (
        <div className="mt-1 md:mt-0 md:w-3/5">
          <fetcher.Form
            method="post"
            ref={formRef}
            onSubmit={handleSubmit}
            onKeyDown={handleKeyDown}
          >
            <input type="hidden" name="intent" value="updateField" />
            {/* Skip default fieldName if overridden via extraHiddenInputs */}
            {!extraHiddenInputs?.fieldName && (
              <input type="hidden" name="fieldName" value={fieldName} />
            )}
            {extraHiddenInputs &&
              Object.entries(extraHiddenInputs).map(([name, value]) => (
                <input key={name} type="hidden" name={name} value={value} />
              ))}

            {renderEditor({ fetcher, onCancel: handleCancel })}

            {errorMessage ? (
              <p className="mt-1 text-sm text-error-500" role="alert">
                {errorMessage}
              </p>
            ) : null}

            {/*
             * Save/Cancel row sits in its own stacking context (relative +
             * z-20) and has a solid background so it stays clickable even
             * when an editor renders an absolutely-positioned dropdown
             * (e.g. the react-tags listbox) that would otherwise overlay
             * and intercept pointer events on the buttons.
             */}
            <div className="relative z-20 mt-2 flex items-center gap-2 bg-white">
              <Button type="submit" disabled={disabled} variant="primary">
                {disabled ? "Saving..." : "Save"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={handleCancel}
                disabled={disabled}
              >
                Cancel
              </Button>
            </div>
          </fetcher.Form>
        </div>
      ) : (
        /*
         * Display mode: render the value as plain content (it may contain its
         * own interactive elements like LocationBadge's HoverCard, so we cannot
         * wrap it in a button). The pencil icon is the only interactive trigger.
         * On desktop the pencil is hover-revealed; on touch it's always visible.
         */
        <div className="relative mt-1 flex items-center gap-2 md:mt-0 md:w-3/5">
          <div className="flex-1">{renderDisplay()}</div>
          {canEdit ? (
            <button
              type="button"
              onClick={handleEnterEdit}
              aria-label={`Edit ${label}`}
              title={`Edit ${label}`}
              className="hidden shrink-0 rounded p-1 text-gray-500 transition-opacity hover:bg-gray-100 hover:text-gray-700 md:inline-flex md:opacity-0 md:group-hover/field:opacity-100 md:focus-visible:opacity-100"
            >
              <Icon icon="pen" disableWrap />
            </button>
          ) : null}
        </div>
      )}
    </li>
  );
}
