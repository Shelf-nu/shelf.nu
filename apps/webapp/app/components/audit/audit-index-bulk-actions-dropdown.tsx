/**
 * @file Audit Index Bulk Actions Dropdown
 *
 * Renders the bulk actions dropdown on the audits index page (`/audits`).
 * Supports:
 * - Bulk archive for COMPLETED/CANCELLED audits
 * - Bulk delete for ARCHIVED audits
 *
 * Only visible to users with the matching permission on the audit entity
 * (admin/owner). Server-side enforcement lives in the bulk-actions API.
 *
 * @see {@link file://./bulk-archive-audits-dialog.tsx} - Archive dialog
 * @see {@link file://./bulk-delete-audits-dialog.tsx} - Delete dialog
 * @see {@link file://../../routes/_layout+/audits._index.tsx} - Consuming page
 */
import { useAtomValue } from "jotai";
import { useHydrated } from "remix-utils/use-hydrated";
import { selectedBulkItemsAtom } from "~/atoms/list";
import { useSearchParams } from "~/hooks/search-params";
import { useControlledDropdownMenu } from "~/hooks/use-controlled-dropdown-menu";
import { useDisabled } from "~/hooks/use-disabled";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import type { AuditListItem } from "~/routes/_layout+/audits._index";
import { isSelectingAllItems } from "~/utils/list";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { tw } from "~/utils/tw";
import BulkArchiveAuditsDialog from "./bulk-archive-audits-dialog";
import BulkDeleteAuditsDialog from "./bulk-delete-audits-dialog";
import { BulkUpdateDialogTrigger } from "../bulk-update-dialog/bulk-update-dialog";
import { Button } from "../shared/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../shared/dropdown";

/**
 * Bulk actions dropdown for the audits index page.
 * Renders a placeholder button during SSR and the full dropdown after hydration.
 */
export default function AuditIndexBulkActionsDropdown() {
  const isHydrated = useHydrated();

  if (!isHydrated) {
    return (
      <Button type="button" variant="secondary" disabled>
        <span className="flex items-center gap-2">Actions</span>
      </Button>
    );
  }

  return (
    <div className="actions-dropdown flex flex-1 justify-end">
      <ConditionalDropdown />
    </div>
  );
}

/** Inner dropdown rendered only after hydration. */
function ConditionalDropdown() {
  const selectedAudits = useAtomValue(selectedBulkItemsAtom);
  const audits = selectedAudits as unknown as AuditListItem[];

  /**
   * Archive is only valid for COMPLETED or CANCELLED audits.
   * When "select all across pages" is active, the selection contains the
   * ALL_SELECTED_KEY sentinel (which has no status) — skip it so the
   * Archive button stays enabled; the server validates statuses anyway.
   */
  const allSelected = isSelectingAllItems(selectedAudits);
  const someNotArchivable =
    !allSelected &&
    audits.some((a) => a.status !== "COMPLETED" && a.status !== "CANCELLED");
  /**
   * Delete is only valid for ARCHIVED audits. For an explicit id-list we
   * check statuses client-side; the server re-validates either way.
   */
  const someNotArchived =
    !allSelected && audits.some((a) => a.status !== "ARCHIVED");

  /**
   * Select-all delete is only allowed when the active status filter is
   * ARCHIVED. Otherwise the user sees a total-items count that mixes
   * statuses, clicks "Delete N", and the server would silently drop
   * everything except the archived subset. Force them to narrow first
   * so the count they see is the count that deletes.
   */
  const [searchParams] = useSearchParams();
  // The audits index loader normalizes `status` to uppercase before querying
  // (see `getAuditWhereInput`), so a deep-link like `?status=archived` still
  // renders the archived list. Match that normalization here or the gate
  // mis-fires against lowercase links.
  const statusFilter = searchParams.get("status")?.toUpperCase();
  const selectAllButFilterNotArchived =
    allSelected && statusFilter !== "ARCHIVED";

  const { roles } = useUserRoleHelper();

  const isLoading = useDisabled();

  const disabled = selectedAudits.length === 0;

  const canArchiveAudit = userHasPermission({
    roles,
    entity: PermissionEntity.audit,
    action: PermissionAction.archive,
  });
  const canDeleteAudit = userHasPermission({
    roles,
    entity: PermissionEntity.audit,
    action: PermissionAction.delete,
  });

  const {
    ref: dropdownRef,
    defaultApplied,
    open,
    defaultOpen,
    setOpen,
  } = useControlledDropdownMenu();

  function closeMenu() {
    setOpen(false);
  }

  return (
    <>
      {open && (
        <div
          className={tw(
            "fixed right-0 top-0 z-10 h-screen w-screen cursor-pointer bg-gray-700/50  transition duration-300 ease-in-out md:hidden"
          )}
          onClick={closeMenu}
          aria-hidden="true"
        />
      )}

      <BulkArchiveAuditsDialog />
      <BulkDeleteAuditsDialog />

      <DropdownMenu
        modal={false}
        onOpenChange={(open) => {
          if (defaultApplied && window.innerWidth <= 640) setOpen(open);
        }}
        open={open}
        defaultOpen={defaultOpen}
      >
        <DropdownMenuTrigger
          className="actions-dropdown hidden sm:flex"
          onClick={() => setOpen(!open)}
          asChild
          disabled={disabled}
        >
          <Button type="button" variant="secondary">
            <span className="flex items-center gap-2">Actions</span>
          </Button>
        </DropdownMenuTrigger>

        {/* Custom mobile trigger to avoid conflicts with overlay */}
        <Button
          variant="secondary"
          className="asset-actions flex-1 sm:hidden"
          onClick={() => setOpen(true)}
          disabled={disabled}
          type="button"
        >
          <span className="flex items-center gap-2">Actions</span>
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

        <DropdownMenuContent
          asChild
          align="end"
          className="order actions-dropdown static w-screen rounded-b-none rounded-t-[4px] bg-white p-0 text-right md:static md:w-[230px] md:rounded-t-[4px]"
          ref={dropdownRef}
        >
          <div className="order fixed bottom-0 left-0 w-screen rounded-b-none rounded-t-[4px] bg-white p-0 text-right md:static md:w-[180px] md:rounded-t-[4px]">
            <DropdownMenuItem
              className="px-4 py-1 md:p-0"
              onSelect={(e) => {
                e.preventDefault();
              }}
            >
              <BulkUpdateDialogTrigger
                type="archive"
                label="Archive"
                onClick={closeMenu}
                disabled={
                  !canArchiveAudit
                    ? {
                        reason: "You don't have permission to archive audits.",
                      }
                    : someNotArchivable
                    ? {
                        reason:
                          "Some of the selected audits are not completed or cancelled. You can only archive audits that are completed or cancelled.",
                      }
                    : isLoading
                }
              />
            </DropdownMenuItem>
            <DropdownMenuItem
              className="px-4 py-1 md:p-0"
              onSelect={(e) => {
                e.preventDefault();
              }}
            >
              <BulkUpdateDialogTrigger
                type="delete-audit"
                label="Delete"
                onClick={closeMenu}
                disabled={
                  !canDeleteAudit
                    ? {
                        reason: "You don't have permission to delete audits.",
                      }
                    : someNotArchived
                    ? {
                        reason:
                          "Some of the selected audits are not archived. Only archived audits can be deleted.",
                      }
                    : selectAllButFilterNotArchived
                    ? {
                        reason:
                          "Filter the list to status = Archived before using Select all to delete.",
                      }
                    : isLoading
                }
              />
            </DropdownMenuItem>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
