import { useCallback, useEffect, useRef, useState } from "react";
import { DateTime } from "luxon";
import { useNavigate, useNavigation } from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";

import Input from "~/components/forms/input";
import Icon from "~/components/icons/icon";
import { Dialog, DialogPortal } from "~/components/layout/dialog";
import { Button } from "~/components/shared/button";
import { Separator } from "~/components/shared/separator";
import { useDisabled } from "~/hooks/use-disabled";
import useFetcherWithReset from "~/hooks/use-fetcher-with-reset";
import { DATE_TIME_FORMAT } from "~/utils/constants";
import { isFormProcessing } from "~/utils/form";
import AuditTeamMemberSelector from "./audit-team-member-selector";

/**
 * Context types supported for starting audits.
 * - location: Audit all assets at a location (optionally including child locations)
 * - kit: Audit all assets in a kit
 * - user: Audit all assets in a user's custody
 */
export type AuditContextType = "location" | "kit" | "user";

/**
 * Zod schema for client-side validation of the start audit from context form.
 */
const StartAuditFromContextFormSchema = z.object({
  name: z.string().trim().min(1, "Audit name is required"),
  description: z
    .string()
    .max(1000, "Description must be 1000 characters or fewer")
    .optional(),
  dueDate: z
    .string()
    .optional()
    .refine(
      (value) => {
        if (!value) return true;
        const parsed = DateTime.fromFormat(value, DATE_TIME_FORMAT);
        return parsed.isValid && parsed > DateTime.now();
      },
      { message: "Due date must be in the future" }
    ),
  assignee: z.string().optional(),
});

type StartAuditResponse = {
  success?: boolean;
  redirectTo?: string;
  error?: {
    message: string;
  };
};

type StartAuditFromContextDialogProps = {
  /** The type of context (location, kit, user) */
  contextType: AuditContextType;
  /** The ID of the context entity */
  contextId: string;
  /** Display name of the context (e.g., location name, kit name) */
  contextName: string;
  /** Number of assets in this context */
  assetCount: number;
  /** Whether this location has child locations (only for location context) */
  hasChildLocations?: boolean;
  /** Controlled dialog state */
  open?: boolean;
  onClose?: () => void;
  /** Render the default trigger button */
  showTrigger?: boolean;
};

/**
 * Self-contained dialog component for starting an audit from a context page.
 * Includes its own trigger button and manages dialog state internally.
 */
export function StartAuditFromContextDialog({
  contextType,
  contextId,
  contextName,
  assetCount,
  hasChildLocations = false,
  open,
  onClose,
  showTrigger = true,
}: StartAuditFromContextDialogProps) {
  const [isUncontrolledOpen, setIsUncontrolledOpen] = useState(false);
  const navigate = useNavigate();
  const navigation = useNavigation();
  const fetcher = useFetcherWithReset<StartAuditResponse>();
  const zo = useZorm("StartAuditFromContext", StartAuditFromContextFormSchema);
  const hasNavigatedRef = useRef(false);

  const isOpen = open ?? isUncontrolledOpen;
  const closeDialog = useCallback(() => {
    onClose?.();
    if (open === undefined) {
      setIsUncontrolledOpen(false);
    }
  }, [onClose, open]);
  const openDialog = useCallback(() => {
    if (open === undefined) {
      setIsUncontrolledOpen(true);
    }
  }, [open]);

  // Need both states: fetcher submission + route navigation (redirect).
  const shouldRedirect = Boolean(
    fetcher.data?.success && fetcher.data.redirectTo
  );
  const isSubmitting =
    // Need both states: fetcher submission + route navigation (redirect).
    useDisabled(fetcher) ||
    isFormProcessing(navigation.state) ||
    shouldRedirect;

  // Navigate to audit on successful creation
  useEffect(() => {
    if (!shouldRedirect || hasNavigatedRef.current) {
      return;
    }

    hasNavigatedRef.current = true;
    void navigate(fetcher.data?.redirectTo ?? "");
  }, [navigate, shouldRedirect, fetcher.data?.redirectTo]);

  // Reset fetcher data when dialog closes
  useEffect(() => {
    if (!isOpen) {
      fetcher.reset();
    }
  }, [isOpen, fetcher]);

  // Generate description text based on context type
  const getDescriptionText = () => {
    const assetText = assetCount === 1 ? "1 asset" : `${assetCount} assets`;
    switch (contextType) {
      case "location":
        return `Start an audit for ${assetText} in "${contextName}".`;
      case "kit":
        return `Start an audit for ${assetText} in kit "${contextName}".`;
      case "user":
        return `Start an audit for ${assetText} in custody of ${contextName}.`;
      default:
        return `Start an audit for ${assetText}.`;
    }
  };

  return (
    <>
      {/* Trigger button */}
      {showTrigger ? (
        <Button
          variant="link"
          className="w-full justify-start px-4 py-3 text-gray-700 hover:bg-slate-100 hover:text-gray-700"
          width="full"
          onClick={openDialog}
        >
          <span className="flex items-center gap-2">
            <Icon icon="start-audit" /> Start audit
          </span>
        </Button>
      ) : null}

      {/* Dialog */}
      <DialogPortal>
        <Dialog
          open={isOpen}
          onClose={closeDialog}
          title={
            <div className="-mb-3 w-full pb-6">
              <h3>Start audit</h3>
              <p className="text-gray-600">{getDescriptionText()}</p>
            </div>
          }
          headerClassName="border-b"
          className="md:w-[800px] [&_.dialog-header>button]:mt-1"
        >
          <fetcher.Form ref={zo.ref} method="post" action="/api/audits/start">
            {/* Hidden fields for context information */}
            <input type="hidden" name="contextType" value={contextType} />
            <input type="hidden" name="contextId" value={contextId} />
            <input type="hidden" name="contextName" value={contextName} />

            <div className="grid grid-cols-1 border-t px-6 pb-4 md:grid-cols-2 md:divide-x">
              {/* Left column: Form fields */}
              <div className="py-4 pr-6">
                <Input
                  name={zo.fields.name()}
                  label="Audit name"
                  placeholder="Quarterly warehouse audit"
                  error={zo.errors.name()?.message}
                  required
                  disabled={isSubmitting}
                  className="mb-4"
                  data-dialog-initial-focus
                />

                <Input
                  name={zo.fields.description()}
                  label="Description"
                  placeholder="Add context that will help auditors (optional)."
                  inputType="textarea"
                  rows={5}
                  error={
                    fetcher.data?.error?.message ||
                    zo.errors.description()?.message
                  }
                  disabled={isSubmitting}
                />

                <Input
                  name={zo.fields.dueDate()}
                  label="Due date"
                  type="datetime-local"
                  error={zo.errors.dueDate()?.message}
                  disabled={isSubmitting}
                  className="mt-4"
                />

                {/* Location-specific: Include child locations checkbox */}
                {contextType === "location" && hasChildLocations && (
                  <div className="mt-4">
                    <label
                      htmlFor="includeChildLocations"
                      className="flex cursor-pointer select-none items-center gap-2 text-sm"
                    >
                      <input
                        id="includeChildLocations"
                        name="includeChildLocations"
                        type="checkbox"
                        disabled={isSubmitting}
                        className="rounded-sm checked:bg-primary focus-within:ring-primary checked:hover:bg-primary checked:focus:bg-primary"
                      />
                      <span>Include assets from child locations</span>
                    </label>
                  </div>
                )}
              </div>

              {/* Right column: Team member selector */}
              <div className="!border-r">
                <Separator className="md:hidden" />
                <p className="border-b p-3 font-medium">
                  Select assignee (optional)
                </p>
                <AuditTeamMemberSelector />
              </div>
            </div>

            {/* Footer buttons */}
            <div className="flex items-center justify-end gap-2 border-t p-4  md:col-span-2">
              <Button
                type="button"
                variant="secondary"
                disabled={isSubmitting}
                onClick={closeDialog}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={isSubmitting}>
                {isSubmitting ? "Starting..." : "Start audit"}
              </Button>
            </div>
          </fetcher.Form>
        </Dialog>
      </DialogPortal>
    </>
  );
}
