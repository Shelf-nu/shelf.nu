import type { CSSProperties, ReactNode, FormEvent } from "react";
import { AnimatePresence } from "framer-motion";
import { Form } from "react-router";
import { useZorm } from "react-zorm";
import type { z } from "zod";
import { AssetLabel } from "~/components/icons/library";
import { ListHeader } from "~/components/list/list-header";
import { Button } from "~/components/shared/button";
import { Table, Th } from "~/components/table";
import When from "~/components/when/when";
import { tw } from "~/utils/tw";
import BaseDrawer from "./base-drawer";
import type { BlockersVariant } from "./blockers-factory";
import { ScanItemGroup } from "./scan-item-group";

// Props for the configurable drawer
type ConfigurableDrawerProps<T> = {
  // Form schema for validation
  schema: z.ZodType<any>;
  // Data to be passed to the form on submission
  formData?: Record<string, any>;
  // Action URL for the form
  actionUrl?: string; // Optional if using the current route's action
  // Method for the form (default: POST)
  method?: "post" | "get";
  // Items to display in the drawer
  items: Record<string, T>;
  // Function to clear all items
  onClearItems: () => void;
  // Title for the drawer
  title: string | ReactNode;
  // Custom empty state content
  emptyStateContent?: ReactNode | ((expanded: boolean) => ReactNode);
  // Whether to render content even when the list is empty
  renderWhenEmpty?: boolean;
  // Loading state
  isLoading?: boolean;
  // Item rendering function
  renderItem?: (qrId: string, item: T) => ReactNode;
  /**
   * The blockers from `createBlockers`. Called as a function, never rendered
   * as `<Blockers />`: it is recreated on every render of the drawer, and a
   * component type that changes each render would remount the card.
   */
  Blockers?: (props?: { variant?: BlockersVariant }) => ReactNode;
  // Whether form submission should be disabled
  disableSubmit?: boolean;

  // Custom submit button text
  submitButtonText?: string;
  // Custom class name for the submit button
  submitButtonClassName?: string;

  // Default expanded state
  defaultExpanded?: boolean;
  // Form submission handler (if you need custom handling)
  onSubmit?: (e: FormEvent) => void;
  // Custom class name
  className?: string;
  // Custom style
  style?: CSSProperties;
  // Form name (for the zorm)
  formName?: string;

  // Optional form component to completely replace the default form.
  // Can be a ReactNode or a function that receives the expanded state.
  // Rendered in the drawer's pinned footer, below the scrolling item list, so
  // a long list can never scroll the submit button out of reach.
  form?: ReactNode | ((expanded: boolean) => ReactNode);

  // Optional header content to render above the item list
  headerContent?: ReactNode;
  // Optional custom render function for all items (if you need full control over rendering)
  customRenderAllItems?: () => ReactNode;
  /**
   * Renders the list as separate groups (e.g. `ScanItemGroup` cards) instead of
   * one table. Each group brings its own table, so the drawer does not wrap
   * them in one. Takes precedence over `customRenderAllItems` and `renderItem`.
   */
  renderGroups?: () => ReactNode;
  // Custom height for the collapsed state when items are present (default: 170)
  collapsedHeight?: number;
};

/**
 * A configurable drawer component for scanned items
 */
export default function ConfigurableDrawer<T>({
  schema,
  formData,
  actionUrl,
  method = "post",
  items,
  onClearItems,
  title,
  emptyStateContent,
  renderWhenEmpty = false,
  isLoading,
  renderItem,
  Blockers,
  disableSubmit = false,
  submitButtonText = "Confirm",
  submitButtonClassName,
  defaultExpanded = false,
  onSubmit,
  className,
  style,
  formName = "ConfigurableDrawerForm",
  form,
  headerContent,
  customRenderAllItems,
  renderGroups,
  collapsedHeight,
}: ConfigurableDrawerProps<T>) {
  const zo = useZorm(formName, schema);
  const itemsLength = Object.keys(items).length;
  const hasItems = itemsLength > 0;

  // Drawers that render one row per item get their rows in a "Scanned this
  // session" card, which carries the count. Custom renderers keep a table.
  const rowsInCard = !renderGroups && !customRenderAllItems && !!renderItem;

  // A string title gets the item count, unless a card already shows it.
  const drawerTitle =
    typeof title === "string" && !rowsInCard && !renderGroups
      ? `${title} (${itemsLength})`
      : title;

  // Default empty state content if none provided
  const defaultEmptyState = (expanded: boolean) => (
    <>
      {expanded && (
        <div className="mb-4 rounded-full bg-primary-50 p-2">
          <div className="rounded-full bg-primary-100 p-2 text-primary">
            <AssetLabel className="size-6" />
          </div>
        </div>
      )}
      <div>
        {expanded && (
          <div className="text-base font-semibold text-gray-900">
            List is empty
          </div>
        )}
        <p className="text-sm text-gray-600">Fill list by scanning codes...</p>
      </div>
    </>
  );
  return (
    <BaseDrawer
      className={className}
      style={style}
      defaultExpanded={defaultExpanded}
      title={drawerTitle}
      onClear={onClearItems}
      hasItems={hasItems}
      renderWhenEmpty={renderWhenEmpty}
      emptyStateContent={emptyStateContent || defaultEmptyState}
      headerContent={headerContent}
      collapsedHeight={collapsedHeight}
      footer={(expanded) => (
        <>
          {/* Why the action is disabled; the fixes are in the list's card. */}
          {Blockers ? Blockers({ variant: "note" }) : null}

          {/* Action form */}
          {form ? (
            typeof form === "function" ? (
              form(expanded)
            ) : (
              form
            )
          ) : formData ? (
            <When truthy={hasItems}>
              <Form
                ref={zo.ref}
                className="flex w-full"
                method={method}
                action={actionUrl}
                onSubmit={onSubmit}
              >
                <div className="flex w-full gap-2 px-3 py-2">
                  {/* Render form fields from formData */}
                  {Object.entries(formData).map(([key, value]) => {
                    if (Array.isArray(value)) {
                      return value.map((val, index) => (
                        // Key uses the value itself (e.g. the scanned qrId),
                        // which is unique per array — the `index` still drives
                        // the submitted field name so form semantics are
                        // preserved.
                        <input
                          key={`${key}-${String(val)}`}
                          type="hidden"
                          name={`${key}[${index}]`}
                          value={val}
                        />
                      ));
                    }
                    return (
                      <input key={key} type="hidden" name={key} value={value} />
                    );
                  })}
                  {/* Cancel button */}
                  <Button
                    type="button"
                    variant="secondary"
                    to={".."}
                    className={"ml-auto"}
                  >
                    Cancel
                  </Button>
                  {/* Submit button */}
                  <Button
                    type="submit"
                    disabled={isLoading || disableSubmit}
                    className={tw(submitButtonClassName, "w-auto")}
                  >
                    {submitButtonText}
                  </Button>
                </div>
              </Form>
            </When>
          ) : null}
        </>
      )}
    >
      {() => (
        <div className="flex flex-col gap-2 py-2">
          {/* Blockers lead the list: they are what stands between the
              operator and the action. */}
          {Blockers ? Blockers({ variant: "card" }) : null}

          {renderGroups ? (
            renderGroups()
          ) : rowsInCard ? (
            <ScanItemGroup
              label="Scanned this session"
              count={itemsLength}
              tone="active"
              openWhenCountGrows
            >
              {Object.entries(items).map(
                ([qrId, item]) => renderItem?.(qrId, item)
              )}
            </ScanItemGroup>
          ) : (
            <Table className="overflow-y-auto">
              <ListHeader hideFirstColumn className="border-none">
                <Th className="p-0"> </Th>
                <Th className="p-0"> </Th>
              </ListHeader>

              <tbody>
                <AnimatePresence>
                  {customRenderAllItems ? customRenderAllItems() : null}
                </AnimatePresence>
              </tbody>
            </Table>
          )}
        </div>
      )}
    </BaseDrawer>
  );
}
