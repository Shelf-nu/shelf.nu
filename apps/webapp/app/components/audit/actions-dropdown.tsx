import { useReducer, useRef, useEffect } from "react";
import { AuditStatus } from "@prisma/client";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { useActionData, useLoaderData } from "react-router";
import { useHydrated } from "remix-utils/use-hydrated";
import { ChevronRight } from "~/components/icons/library";
import { useSearchParams } from "~/hooks/search-params";
import { useControlledDropdownMenu } from "~/hooks/use-controlled-dropdown-menu";
import { useUserData } from "~/hooks/use-user-data";
import type { loader, action } from "~/routes/_layout+/audits.$auditId";
import { tw } from "~/utils/tw";
import { ArchiveAuditDialog } from "./archive-audit-dialog";
import { AuditReceiptPDF } from "./audit-receipt-pdf";
import { CancelAuditDialog } from "./cancel-audit-dialog";
import { DeleteAuditDialog } from "./delete-audit-dialog";
import { EditAuditDialog } from "./edit-audit-dialog";
import { Button } from "../shared/button";
import { MobileDropdownStyles } from "../shared/mobile-dropdown-styles";
import When from "../when/when";

const receiptAutoOpenKey = "auditReceiptAutoOpen";

/**
 * Which audit action dialog is currently open (if any). All five dialogs are
 * mutually exclusive, so we consolidate their open/close state into a single
 * discriminated value instead of five separate booleans.
 */
type AuditDialogKind =
  | "none"
  | "edit"
  | "cancel"
  | "archive"
  | "delete"
  | "receipt";

type DialogAction =
  | { type: "open"; dialog: Exclude<AuditDialogKind, "none"> }
  | { type: "close" };

function dialogReducer(
  _state: AuditDialogKind,
  action: DialogAction
): AuditDialogKind {
  switch (action.type) {
    case "open":
      return action.dialog;
    case "close":
      return "none";
  }
}

const ConditionalActionsDropdown = () => {
  const { session, isAdminOrOwner, teamMembers } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const user = useUserData();
  const { ref: popoverContentRef, open, setOpen } = useControlledDropdownMenu();
  const [openDialog, dispatchDialog] = useReducer(dialogReducer, "none");
  const isEditDialogOpen = openDialog === "edit";
  const isCancelDialogOpen = openDialog === "cancel";
  const isArchiveDialogOpen = openDialog === "archive";
  const isDeleteDialogOpen = openDialog === "delete";
  const isReceiptDialogOpen = openDialog === "receipt";
  // Track auto-open so the email deep link only triggers once.
  const hasAutoOpenedReceiptRef = useRef(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const isCompleted = session.status === AuditStatus.COMPLETED;
  const isCancelled = session.status === AuditStatus.CANCELLED;
  const isArchived = session.status === AuditStatus.ARCHIVED;
  const isCreator = session.createdById === user?.id;
  const receiptRequested = searchParams.get("receipt") === "1";

  // Only admin/owner can edit audit details
  const canEditAudit =
    isAdminOrOwner && !isCompleted && !isCancelled && !isArchived;

  // Admin/owner can archive completed or cancelled audits
  const canArchiveAudit =
    isAdminOrOwner && (isCompleted || isCancelled) && !isArchived;

  // Admin/owner can delete archived audits (archive-first safety contract).
  const canDeleteAudit = isAdminOrOwner && isArchived;

  // The audit's creator can always cancel it. Workspace admins/owners can
  // also cancel any audit in the org so team-managed audits don't get stuck
  // when the creator is unavailable — matches archive/delete permissions.
  const canCancelAudit =
    (isCreator || isAdminOrOwner) &&
    !isCompleted &&
    !isCancelled &&
    !isArchived;

  function handleMenuClose() {
    setOpen(false);
  }

  useEffect(() => {
    if (receiptRequested && !hasAutoOpenedReceiptRef.current) {
      // Prevent duplicate auto-opens when multiple dropdown instances exist.
      if (typeof window !== "undefined") {
        const existing = window.sessionStorage.getItem(receiptAutoOpenKey);
        if (existing === session.id) {
          return;
        }
        window.sessionStorage.setItem(receiptAutoOpenKey, session.id);
      }
      // Open receipt preview when coming from the email link.
      dispatchDialog({ type: "open", dialog: "receipt" });
      hasAutoOpenedReceiptRef.current = true;
      // Remove receipt flag so closing the dialog doesn't re-trigger.
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("receipt");
      setSearchParams(nextParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiptRequested, searchParams, setSearchParams]);

  return (
    <>
      {open && (
        <div
          className={tw(
            "fixed right-0 top-0 z-10 h-screen w-screen cursor-pointer bg-gray-700/50 transition duration-300 ease-in-out md:hidden"
          )}
        />
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="secondary"
            data-test-id="auditActionsButton"
            className="actions-dropdown hidden sm:flex"
          >
            <span className="flex items-center gap-2">
              Actions <ChevronRight className="chev" />
            </span>
          </Button>
        </PopoverTrigger>

        {/* using custom trigger on mobile which only opens popover to avoid conflicts with overlay */}
        <Button
          type="button"
          variant="secondary"
          data-test-id="auditActionsButton"
          className="actions-dropdown sm:hidden"
          onClick={() => setOpen(true)}
        >
          <span className="flex items-center gap-2">
            Actions <ChevronRight className="chev" />
          </span>
        </Button>

        <MobileDropdownStyles open={open} />
        <PopoverPortal>
          <PopoverContent
            ref={popoverContentRef}
            tabIndex={-1}
            align="end"
            side="bottom"
            sideOffset={4}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              popoverContentRef.current?.focus();
            }}
            className="order actions-dropdown static z-[99] !mt-0 w-screen rounded-b-none rounded-t-[4px] border border-gray-300 bg-white p-0 text-right md:static md:mt-auto md:w-[230px] md:rounded-t-[4px]"
          >
            <div className="order fixed bottom-0 left-0 w-screen rounded-b-none rounded-t-[4px] bg-white p-0 text-right md:static md:w-full md:rounded-t-[4px]">
              <When truthy={canEditAudit}>
                <div className="border-b px-0 py-1 md:p-0">
                  <Button
                    type="button"
                    variant="link"
                    className="justify-start px-4 py-3 text-gray-700 hover:bg-slate-100 hover:text-gray-700"
                    width="full"
                    onClick={() => {
                      handleMenuClose();
                      dispatchDialog({ type: "open", dialog: "edit" });
                    }}
                  >
                    <span className="flex items-center gap-2">
                      Edit details
                    </span>
                  </Button>
                </div>
              </When>

              <When truthy={canCancelAudit}>
                <div className="border-b px-0 py-1 md:p-0">
                  <Button
                    type="button"
                    variant="link"
                    className="justify-start px-4 py-3 text-gray-700 hover:bg-slate-100 hover:text-gray-700"
                    width="full"
                    onClick={() => {
                      handleMenuClose();
                      dispatchDialog({ type: "open", dialog: "cancel" });
                    }}
                  >
                    <span className="flex items-center gap-2">
                      Cancel audit
                    </span>
                  </Button>
                </div>
              </When>

              <When truthy={canArchiveAudit}>
                <div className="border-b px-0 py-1 md:p-0">
                  <Button
                    type="button"
                    variant="link"
                    className="justify-start px-4 py-3 text-gray-700 hover:bg-slate-100 hover:text-gray-700"
                    width="full"
                    onClick={() => {
                      handleMenuClose();
                      dispatchDialog({ type: "open", dialog: "archive" });
                    }}
                  >
                    Archive
                  </Button>
                </div>
              </When>

              <When truthy={canDeleteAudit}>
                <div className="border-b px-0 py-1 md:p-0">
                  <Button
                    type="button"
                    variant="link"
                    className="justify-start px-4 py-3 text-error-700 hover:bg-slate-100 hover:text-error-700"
                    width="full"
                    onClick={() => {
                      handleMenuClose();
                      dispatchDialog({ type: "open", dialog: "delete" });
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </When>

              {/* PDF Download Button - Always visible for all users with audit read permission */}
              <div className="border-b px-0 py-1 md:p-0">
                <Button
                  type="button"
                  variant="link"
                  className="justify-start px-4 py-3 text-gray-700 hover:bg-slate-100 hover:text-gray-700"
                  width="full"
                  onClick={() => {
                    handleMenuClose();
                    dispatchDialog({ type: "open", dialog: "receipt" });
                  }}
                >
                  <span className="flex items-center gap-2">
                    Download Receipt
                  </span>
                </Button>
              </div>

              <div className="border-t p-4 md:hidden md:p-0">
                <Button
                  type="button"
                  role="button"
                  variant="secondary"
                  className="flex items-center justify-center text-gray-700 hover:text-gray-700"
                  width="full"
                  onClick={handleMenuClose}
                >
                  Close
                </Button>
              </div>
            </div>
          </PopoverContent>
        </PopoverPortal>
      </Popover>

      <When truthy={isEditDialogOpen}>
        <EditAuditDialog
          audit={session}
          teamMembers={teamMembers}
          open={isEditDialogOpen}
          onClose={() => dispatchDialog({ type: "close" })}
          actionData={actionData}
        />
      </When>
      <When truthy={isCancelDialogOpen}>
        <CancelAuditDialog
          auditName={session.name}
          open={isCancelDialogOpen}
          onClose={() => dispatchDialog({ type: "close" })}
        />
      </When>

      <When truthy={isArchiveDialogOpen}>
        <ArchiveAuditDialog
          auditName={session.name}
          open={isArchiveDialogOpen}
          onClose={() => dispatchDialog({ type: "close" })}
        />
      </When>

      <When truthy={isDeleteDialogOpen}>
        <DeleteAuditDialog
          auditName={session.name}
          open={isDeleteDialogOpen}
          onClose={() => dispatchDialog({ type: "close" })}
        />
      </When>

      {/* Receipt dialog */}
      <AuditReceiptPDF
        audit={{ id: session.id, name: session.name, status: session.status }}
        open={isReceiptDialogOpen}
        onClose={() => dispatchDialog({ type: "close" })}
      />
    </>
  );
};

export const ActionsDropdown = () => {
  const isHydrated = useHydrated();

  if (!isHydrated)
    return (
      <Button variant="secondary" to="#" data-test-id="auditActionsButton">
        <span className="flex items-center gap-2">
          Actions <ChevronRight className="chev rotate-90" />
        </span>
      </Button>
    );

  return (
    <div className="actions-dropdown flex">
      <ConditionalActionsDropdown />
    </div>
  );
};
