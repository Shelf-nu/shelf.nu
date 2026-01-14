import { useState, useRef } from "react";
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
import { useControlledDropdownMenu } from "~/hooks/use-controlled-dropdown-menu";
import { useUserData } from "~/hooks/use-user-data";
import type { loader, action } from "~/routes/_layout+/audits.$auditId";
import { tw } from "~/utils/tw";
import { AuditReceiptPDF, type AuditReceiptPDFRef } from "./audit-receipt-pdf";
import { CancelAuditDialog } from "./cancel-audit-dialog";
import { EditAuditDialog } from "./edit-audit-dialog";
import { Button } from "../shared/button";
import When from "../when/when";

const ConditionalActionsDropdown = () => {
  const { session, isAdminOrOwner } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const user = useUserData();
  const { ref: popoverContentRef, open, setOpen } = useControlledDropdownMenu();
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false);
  // PDF generation state - tracks loading state for button feedback
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  // Ref to imperatively trigger PDF generation
  const pdfRef = useRef<AuditReceiptPDFRef>(null);

  const isCompleted = session.status === AuditStatus.COMPLETED;
  const isCancelled = session.status === AuditStatus.CANCELLED;
  const isCreator = session.createdById === user?.id;

  // Only admin/owner can edit audit details
  const canEditAudit = isAdminOrOwner && !isCompleted && !isCancelled;

  // Only the creator can cancel an audit, and only if it's not already completed or cancelled
  const canCancelAudit = isCreator && !isCompleted && !isCancelled;

  function handleMenuClose() {
    setOpen(false);
  }

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
          variant="secondary"
          data-test-id="auditActionsButton"
          className="actions-dropdown sm:hidden"
          onClick={() => setOpen(true)}
        >
          <span className="flex items-center gap-2">
            Actions <ChevronRight className="chev" />
          </span>
        </Button>

        {open && (
          <style
            dangerouslySetInnerHTML={{
              __html: `@media (max-width: 640px) {
                [data-radix-popper-content-wrapper] {
                  transform: none !important;
                  will-change: auto !important;
                }
              }`,
            }}
          ></style>
        )}
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
                      setIsEditDialogOpen(true);
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
                      setIsCancelDialogOpen(true);
                    }}
                  >
                    <span className="flex items-center gap-2">
                      Cancel audit
                    </span>
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
                  disabled={isGeneratingPdf}
                  onClick={() => {
                    handleMenuClose();
                    // Trigger PDF generation via ref API
                    pdfRef.current?.generatePdf();
                  }}
                >
                  <span className="flex items-center gap-2">
                    {/* Show loading text while PDF is being generated */}
                    {isGeneratingPdf
                      ? "Generating receipt..."
                      : "Download Receipt"}
                  </span>
                </Button>
              </div>

              <div className="border-t p-4 md:hidden md:p-0">
                <Button
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
          open={isEditDialogOpen}
          onClose={() => setIsEditDialogOpen(false)}
          actionData={actionData}
        />
      </When>
      <When truthy={isCancelDialogOpen}>
        <CancelAuditDialog
          auditName={session.name}
          open={isCancelDialogOpen}
          onClose={() => setIsCancelDialogOpen(false)}
        />
      </When>

      {/* Hidden PDF component - always mounted but only renders when triggered */}
      <AuditReceiptPDF
        ref={pdfRef}
        audit={{ id: session.id, name: session.name, status: session.status }}
        onGenerateStart={() => setIsGeneratingPdf(true)}
        onGenerateEnd={() => setIsGeneratingPdf(false)}
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
