import { useEffect, useReducer } from "react";
import type { User } from "@prisma/client";
import { OrganizationRoles } from "@prisma/client";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { useFetcher } from "react-router";
import { ChevronRight, SuccessIcon } from "~/components/icons/library";
import type { UserFriendlyRoles } from "~/routes/_layout+/settings.team";
import { isFormProcessing } from "~/utils/form";
import { handleActivationKeyPress } from "~/utils/keyboard";
import { isDemotion } from "~/utils/roles";
import { tw } from "~/utils/tw";
import { Button } from "../shared/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../shared/modal";

const roleOptions: Record<string, UserFriendlyRoles> = {
  [OrganizationRoles.ADMIN]: "Administrator",
  [OrganizationRoles.BASE]: "Base",
  [OrganizationRoles.SELF_SERVICE]: "Self service",
};

interface EntityCounts {
  assets: number;
  categories: number;
  tags: number;
  locations: number;
  customFields: number;
  bookings: number;
  kits: number;
  assetReminders: number;
  images: number;
  total: number;
}

interface TransferRecipient {
  id: string;
  name: string;
  email: string;
  isOwner: boolean;
}

/**
 * Consolidated UI state for {@link ChangeRoleDialog}.
 *
 * Replaces five parallel `useState` hooks to satisfy `prefer-useReducer` and
 * to allow atomic transitions (e.g. selecting a role *and* closing its popover
 * in a single dispatch) that previously required cascading `setState` calls —
 * the root cause of the `no-cascading-set-state` diagnostic.
 */
interface DialogState {
  selectedRole: string;
  transferToUserId: string;
  rolePopoverOpen: boolean;
  recipientPopoverOpen: boolean;
  isSuccess: boolean;
}

type DialogAction =
  | { type: "selectRole"; role: string }
  | { type: "selectRecipient"; userId: string }
  | { type: "setDefaultRecipient"; userId: string }
  | { type: "setRolePopover"; open: boolean }
  | { type: "setRecipientPopover"; open: boolean }
  | { type: "markSuccess" }
  | { type: "reset"; currentRoleEnum: string };

function dialogReducer(state: DialogState, action: DialogAction): DialogState {
  switch (action.type) {
    case "selectRole":
      // Atomic: choose role + close its popover. Previously required two
      // separate setState calls, which triggered `no-cascading-set-state`.
      return {
        ...state,
        selectedRole: action.role,
        rolePopoverOpen: false,
      };
    case "selectRecipient":
      return {
        ...state,
        transferToUserId: action.userId,
        recipientPopoverOpen: false,
      };
    case "setDefaultRecipient":
      if (state.transferToUserId) return state;
      return { ...state, transferToUserId: action.userId };
    case "setRolePopover":
      return { ...state, rolePopoverOpen: action.open };
    case "setRecipientPopover":
      return { ...state, recipientPopoverOpen: action.open };
    case "markSuccess":
      return { ...state, isSuccess: true };
    case "reset":
      return {
        selectedRole: action.currentRoleEnum,
        transferToUserId: "",
        rolePopoverOpen: false,
        recipientPopoverOpen: false,
        isSuccess: false,
      };
    default:
      return state;
  }
}

export function ChangeRoleDialog({
  userId,
  currentRoleEnum,
  open,
  onOpenChange,
}: {
  userId: User["id"];
  currentRoleEnum: OrganizationRoles;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const fetcher = useFetcher<{ error?: { message: string } }>();
  const countsFetcher = useFetcher<EntityCounts>();
  const recipientsFetcher = useFetcher<TransferRecipient[]>();
  const disabled = isFormProcessing(fetcher.state);

  const [state, dispatch] = useReducer(dialogReducer, {
    selectedRole: currentRoleEnum as string,
    transferToUserId: "",
    rolePopoverOpen: false,
    recipientPopoverOpen: false,
    isSuccess: false,
  });
  const {
    selectedRole,
    transferToUserId,
    rolePopoverOpen,
    recipientPopoverOpen,
    isSuccess,
  } = state;

  const isSameRole = selectedRole === currentRoleEnum;
  const showDemotion =
    !isSameRole &&
    isDemotion(currentRoleEnum, selectedRole as OrganizationRoles);

  /** Load entity counts and recipients when demotion is detected */
  useEffect(() => {
    if (open && showDemotion) {
      void countsFetcher.load(`/api/user/entity-counts?userId=${userId}`);
      void recipientsFetcher.load(
        `/api/user/transfer-recipients?excludeUserId=${userId}`
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, showDemotion, userId]);

  /** Pre-select the owner as default transfer recipient */
  useEffect(() => {
    const recipients = recipientsFetcher.data;
    if (recipients && recipients.length > 0 && !transferToUserId) {
      const owner = recipients.find((r) => r.isOwner);
      dispatch({
        type: "setDefaultRecipient",
        userId: owner?.id ?? recipients[0].id,
      });
    }
  }, [recipientsFetcher.data, transferToUserId]);

  /** Show success state on successful response */
  useEffect(() => {
    if (fetcher.data && !fetcher.data.error && fetcher.state === "idle") {
      dispatch({ type: "markSuccess" });
    }
  }, [fetcher.data, fetcher.state]);

  /** Reset state when dialog closes */
  useEffect(() => {
    if (!open) {
      dispatch({ type: "reset", currentRoleEnum });
    }
  }, [open, currentRoleEnum]);

  const entityCounts = countsFetcher.data;
  const recipients = recipientsFetcher.data;
  const isLoadingDemotionData =
    countsFetcher.state === "loading" || recipientsFetcher.state === "loading";

  const selectedRecipient = recipients?.find((r) => r.id === transferToUserId);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent aria-describedby="change-role-description">
        {isSuccess ? (
          <>
            <div className="flex flex-col items-center py-6 text-center">
              <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-success-50">
                <SuccessIcon className="size-6 text-success-600" />
              </div>
              <AlertDialogHeader className="mb-0">
                <AlertDialogTitle>Role updated successfully</AlertDialogTitle>
                <AlertDialogDescription id="change-role-description">
                  The user's role has been changed. The change takes effect
                  immediately.
                </AlertDialogDescription>
              </AlertDialogHeader>
            </div>
            <AlertDialogFooter>
              <Button
                type="button"
                variant="secondary"
                width="full"
                onClick={() => onOpenChange(false)}
              >
                Close
              </Button>
            </AlertDialogFooter>
          </>
        ) : (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Change user role</AlertDialogTitle>
              <AlertDialogDescription id="change-role-description">
                Change this user's role in the workspace. This takes effect
                immediately.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="changeRole" />
              <input type="hidden" name="userId" value={userId} />
              <input type="hidden" name="role" value={selectedRole} />
              {showDemotion && transferToUserId ? (
                <input
                  type="hidden"
                  name="transferToUserId"
                  value={transferToUserId}
                />
              ) : null}

              <div className="py-3">
                <label htmlFor="role-select" className="mb-1 block font-medium">
                  Role
                </label>
                <Popover
                  open={rolePopoverOpen}
                  onOpenChange={(nextOpen) =>
                    dispatch({ type: "setRolePopover", open: nextOpen })
                  }
                >
                  <PopoverTrigger asChild>
                    <Button
                      id="role-select"
                      type="button"
                      variant="secondary"
                      className="w-full justify-start font-normal [&_span]:max-w-full [&_span]:truncate"
                    >
                      <ChevronRight className="ml-[2px] inline-block rotate-90" />
                      <span className="ml-2">
                        {roleOptions[selectedRole] || "Select role"}
                      </span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverPortal>
                    <PopoverContent
                      align="start"
                      className={tw(
                        "z-[999999] mt-2 w-[var(--radix-popover-trigger-width)] overflow-hidden rounded-md border border-gray-200 bg-white"
                      )}
                    >
                      {Object.entries(roleOptions).map(([k, v]) => (
                        <div
                          key={k}
                          role="option"
                          aria-selected={selectedRole === k}
                          tabIndex={0}
                          className={tw(
                            "px-4 py-2 text-[14px] text-gray-600 hover:cursor-pointer hover:bg-gray-50",
                            selectedRole === k && "bg-gray-50 font-medium"
                          )}
                          onClick={() =>
                            dispatch({ type: "selectRole", role: k })
                          }
                          onKeyDown={handleActivationKeyPress(() =>
                            dispatch({ type: "selectRole", role: k })
                          )}
                        >
                          {v}
                        </div>
                      ))}
                    </PopoverContent>
                  </PopoverPortal>
                </Popover>

                {showDemotion ? (
                  <div className="mt-4 rounded-md border border-warning-200 bg-warning-25 p-3">
                    <p className="text-sm font-medium text-warning-700">
                      Demotion — entities will be transferred
                    </p>
                    {isLoadingDemotionData ? (
                      <p className="mt-2 text-sm text-gray-600">
                        Loading entity counts...
                      </p>
                    ) : entityCounts && entityCounts.total > 0 ? (
                      <>
                        <p className="mt-2 text-sm text-gray-600">
                          This user owns{" "}
                          <strong>{entityCounts.total} entities</strong> that
                          will be transferred to the selected recipient:
                        </p>
                        <ul className="mt-1 list-inside list-disc text-sm text-gray-600">
                          {entityCounts.assets > 0 && (
                            <li>{entityCounts.assets} assets</li>
                          )}
                          {entityCounts.categories > 0 && (
                            <li>{entityCounts.categories} categories</li>
                          )}
                          {entityCounts.tags > 0 && (
                            <li>{entityCounts.tags} tags</li>
                          )}
                          {entityCounts.locations > 0 && (
                            <li>{entityCounts.locations} locations</li>
                          )}
                          {entityCounts.customFields > 0 && (
                            <li>{entityCounts.customFields} custom fields</li>
                          )}
                          {entityCounts.bookings > 0 && (
                            <li>{entityCounts.bookings} bookings</li>
                          )}
                          {entityCounts.kits > 0 && (
                            <li>{entityCounts.kits} kits</li>
                          )}
                          {entityCounts.assetReminders > 0 && (
                            <li>
                              {entityCounts.assetReminders} asset reminders
                            </li>
                          )}
                          {entityCounts.images > 0 && (
                            <li>{entityCounts.images} images</li>
                          )}
                        </ul>

                        {recipients && recipients.length > 0 ? (
                          <div className="mt-3">
                            <label
                              htmlFor="recipient-select"
                              className="mb-1 block text-sm font-medium"
                            >
                              Transfer entities to
                            </label>
                            <Popover
                              open={recipientPopoverOpen}
                              onOpenChange={(nextOpen) =>
                                dispatch({
                                  type: "setRecipientPopover",
                                  open: nextOpen,
                                })
                              }
                            >
                              <PopoverTrigger asChild>
                                <Button
                                  id="recipient-select"
                                  type="button"
                                  variant="secondary"
                                  className="w-full justify-start font-normal [&_span]:max-w-full [&_span]:truncate"
                                >
                                  <ChevronRight className="ml-[2px] inline-block rotate-90" />
                                  <span className="ml-2">
                                    {selectedRecipient
                                      ? `${selectedRecipient.name}${
                                          selectedRecipient.isOwner
                                            ? " (Owner)"
                                            : ""
                                        } — ${selectedRecipient.email}`
                                      : "Select recipient"}
                                  </span>
                                </Button>
                              </PopoverTrigger>
                              <PopoverPortal>
                                <PopoverContent
                                  align="start"
                                  className={tw(
                                    "z-[999999] mt-2 max-h-[200px] w-[var(--radix-popover-trigger-width)] overflow-auto rounded-md border border-gray-200 bg-white"
                                  )}
                                >
                                  {recipients.map((r) => (
                                    <div
                                      key={r.id}
                                      role="option"
                                      aria-selected={transferToUserId === r.id}
                                      tabIndex={0}
                                      className={tw(
                                        "px-4 py-2 text-[14px] text-gray-600 hover:cursor-pointer hover:bg-gray-50",
                                        transferToUserId === r.id &&
                                          "bg-gray-50 font-medium"
                                      )}
                                      onClick={() =>
                                        dispatch({
                                          type: "selectRecipient",
                                          userId: r.id,
                                        })
                                      }
                                      onKeyDown={handleActivationKeyPress(() =>
                                        dispatch({
                                          type: "selectRecipient",
                                          userId: r.id,
                                        })
                                      )}
                                    >
                                      {r.name}
                                      {r.isOwner ? " (Owner)" : ""} — {r.email}
                                    </div>
                                  ))}
                                </PopoverContent>
                              </PopoverPortal>
                            </Popover>
                          </div>
                        ) : null}
                      </>
                    ) : entityCounts && entityCounts.total === 0 ? (
                      <p className="mt-2 text-sm text-gray-600">
                        This user has no entities to transfer.
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {fetcher.data?.error ? (
                  <p className="mt-3 text-sm text-error-500">
                    {fetcher.data.error.message}
                  </p>
                ) : null}
              </div>

              <AlertDialogFooter className="mt-2 flex items-center gap-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  type="button"
                  disabled={disabled}
                  onClick={() => onOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="flex-1"
                  disabled={
                    disabled ||
                    isSameRole ||
                    (showDemotion && isLoadingDemotionData)
                  }
                >
                  {disabled ? "Changing..." : "Change role"}
                </Button>
              </AlertDialogFooter>
            </fetcher.Form>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
