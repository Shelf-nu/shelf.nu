import { Form } from "@remix-run/react";
import { AnimatePresence } from "framer-motion";
import { useZorm } from "react-zorm";
import type { z } from "zod";
import { AssetLabel } from "~/components/icons/library";
import { ListHeader } from "~/components/list/list-header";
import { Button } from "~/components/shared/button";
import { Table, Th } from "~/components/table";
import When from "~/components/when/when";
import BaseDrawer from "./base-drawer";

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
  title: string;
  // Custom empty state content
  emptyStateContent?:
    | React.ReactNode
    | ((expanded: boolean) => React.ReactNode);
  // Loading state
  isLoading?: boolean;
  // Item rendering function
  renderItem: (qrId: string, item: T) => React.ReactNode;
  // Blockers component (from createBlockers)
  Blockers?: React.ComponentType;
  // Whether form submission should be disabled
  disableSubmit?: boolean;
  // Custom submit button text
  submitButtonText?: string;
  // Default expanded state
  defaultExpanded?: boolean;
  // Form submission handler (if you need custom handling)
  onSubmit?: (e: React.FormEvent) => void;
  // Custom class name
  className?: string;
  // Custom style
  style?: React.CSSProperties;
  // Form name (for the zorm)
  formName?: string;

  // Optional form component to completely replace the default form
  form?: React.ReactNode;
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
  isLoading,
  renderItem,
  Blockers,
  disableSubmit = false,
  submitButtonText = "Confirm",
  defaultExpanded = false,
  onSubmit,
  className,
  style,
  formName = "ConfigurableDrawerForm",
  form,
}: ConfigurableDrawerProps<T>) {
  const zo = useZorm(formName, schema);
  const itemsLength = Object.keys(items).length;
  const hasItems = itemsLength > 0;

  // Create the title with item count
  const drawerTitle = `${title} (${itemsLength})`;

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
      emptyStateContent={emptyStateContent || defaultEmptyState}
    >
      {/* No need to pass expanded state to this content since we don't use it */}
      <>
        {/* Item List */}
        <Table className="overflow-y-auto">
          <ListHeader hideFirstColumn className="border-none">
            <Th className="p-0"> </Th>
            <Th className="p-0"> </Th>
          </ListHeader>

          <tbody>
            <AnimatePresence>
              {Object.entries(items).map(([qrId, item]) =>
                renderItem(qrId, item)
              )}
            </AnimatePresence>
          </tbody>
        </Table>

        {/* Blockers */}
        {Blockers && <Blockers />}

        {/* Action form */}
        {form ? (
          form
        ) : formData ? (
          <When truthy={hasItems}>
            <Form
              ref={zo.ref}
              className="mb-4 flex max-h-full w-full"
              method={method}
              action={actionUrl}
              onSubmit={onSubmit}
            >
              <div className="flex w-full gap-2 p-3">
                {/* Render form fields from formData */}
                {Object.entries(formData).map(([key, value]) => {
                  if (Array.isArray(value)) {
                    return value.map((val, index) => (
                      <input
                        key={`${key}-${index}`}
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

                <Button
                  width="full"
                  type="submit"
                  disabled={isLoading || disableSubmit}
                >
                  {submitButtonText}
                </Button>
              </div>
            </Form>
          </When>
        ) : null}
      </>
    </BaseDrawer>
  );
}
