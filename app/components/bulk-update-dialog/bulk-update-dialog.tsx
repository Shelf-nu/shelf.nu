import { forwardRef, useCallback, useEffect } from "react";
import { useLoaderData } from "@remix-run/react";

import { useAtomValue, useSetAtom } from "jotai";
import {
  bulkDialogAtom,
  closeBulkDialogAtom,
  openBulkDialogAtom,
} from "~/atoms/bulk-update-dialog";
import {
  selectedBulkItemsAtom,
  selectedBulkItemsCountAtom,
} from "~/atoms/list";
import { useSearchParams } from "~/hooks/search-params";
import useFetcherWithReset from "~/hooks/use-fetcher-with-reset";
import { isFormProcessing } from "~/utils/form";
import { tw } from "~/utils/tw";
import Icon from "../icons/icon";
import { Dialog, DialogPortal } from "../layout/dialog";
import type { ListItemData } from "../list/list-item";
import { Button } from "../shared/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "../shared/hover-card";

/**
 * Type of the dialog
 * This `type` will be used to find which dialog to open while clicking on trigger
 * */
type BulkDialogType =
  | "location"
  | "category"
  | "assign-custody"
  | "release-custody"
  | "trash"
  | "activate"
  | "deactivate"
  | "archive"
  | "tag-add"
  | "tag-remove"
  | "cancel"
  | "available"
  | "unavailable"
  | "bookings"
  | "booking-exist"
  | "download-qr";

type CommonBulkDialogProps = {
  type: BulkDialogType;
};

type BulkUpdateDialogTriggerProps = CommonBulkDialogProps & {
  label?: string;
  onClick?: () => void;
  /** Disabled can be a boolean  */
  disabled?:
    | boolean
    | {
        reason: string;
      };
};

/** This component is going to trigger the open state of dialog */
function BulkUpdateDialogTrigger({
  type,
  onClick,
  label = `Update ${type}`,
  disabled,
}: BulkUpdateDialogTriggerProps) {
  const isDisabled =
    disabled === undefined // If it is undefined, then it is not disabled
      ? false
      : typeof disabled === "boolean"
      ? disabled
      : true; // If it is an object, then it is disabled
  const reason = typeof disabled === "object" ? disabled.reason : "";

  const openBulkDialog = useSetAtom(openBulkDialogAtom);

  function handleOpenDialog() {
    openBulkDialog(type);
  }

  /** The actual button */
  function ClickMe({ disabled }: { disabled?: boolean }) {
    return (
      <Button
        variant="link"
        className={tw(
          "w-full justify-start px-4  py-3 text-color-700 hover:text-color-700"
        )}
        width="full"
        onClick={() => {
          onClick && onClick();
          handleOpenDialog();
        }}
        disabled={disabled}
      >
        <span className="flex items-center gap-2">
          <Icon icon={type} /> {label}
        </span>
      </Button>
    );
  }

  if (disabled) {
    return (
      <HoverCard openDelay={50} closeDelay={50}>
        <HoverCardTrigger
          className={tw("disabled inline-flex w-full cursor-not-allowed ")}
        >
          <ClickMe disabled={isDisabled} />
        </HoverCardTrigger>
        {reason && (
          <HoverCardContent side="left">
            <h5 className="text-left text-[14px]">Action disabled</h5>
            <p className="text-left text-[14px]">{reason}</p>
          </HoverCardContent>
        )}
      </HoverCard>
    );
  }

  return <ClickMe />;
}

type DialogContentChildrenProps = {
  disabled: boolean;
  handleCloseDialog: () => void;
  fetcherError?: string;
  fetcherErrorAdditionalData?: Record<string, any>;
  fetcherData?: Record<string, any>;
};

type BulkUpdateDialogContentProps = CommonBulkDialogProps & {
  /**
   * Additional className to dialog
   */
  className?: string;
  /**
   * Title for the Dialog content
   * @default `Update ${type}`
   */
  title?: string;
  /**
   * Description for the dialog content
   * @default `Adjust the ${type} of selected (${itemsSelected}) assets.`
   */
  description?: string;
  /**
   * URL of your action handler
   * @example /api/assets/update-bulk-location
   *  */
  actionUrl?: string;
  /**
   * This will be called when the request was success
   */
  onSuccess?: () => void;
  /**
   * Content to be rendered inside the Dialog.
   * It can either be a `React.ReactNode` or it can be a function returning `React.ReactNode`
   * The function can receive props like `disabled`, `handleCloseDialog`, `fetcherError` with {@link DialogContentChildrenProps}
   */
  children:
    | React.ReactNode
    | ((props: DialogContentChildrenProps) => React.ReactNode);
  /**
   * Id of the array input field
   */
  arrayFieldId: string;
  /**
   * If `true` then the dialog will not close after the success of dialog action.
   */
  skipCloseOnSuccess?: boolean;
};

/** This component is basically the body of the Dialog */
const BulkUpdateDialogContent = forwardRef<
  React.ElementRef<"form">,
  BulkUpdateDialogContentProps
>(function (
  {
    className,
    type,
    children,
    onSuccess,
    title = `Update ${type}`,
    description,
    actionUrl,
    arrayFieldId,
    skipCloseOnSuccess = false,
  },
  ref
) {
  const { items } = useLoaderData<{ items: ListItemData[] }>();

  const fetcher = useFetcherWithReset<any>();
  const disabled = isFormProcessing(fetcher.state);

  const [searchParams] = useSearchParams();

  const bulkDialogOpenState = useAtomValue(bulkDialogAtom);
  const closeBulkDialog = useSetAtom(closeBulkDialogAtom);

  const selectedItems = useAtomValue(selectedBulkItemsAtom);
  const totalItemsSelected = useAtomValue(selectedBulkItemsCountAtom);
  const setSelectedItems = useSetAtom(selectedBulkItemsAtom);

  const isDialogOpen = bulkDialogOpenState[type] === true;

  const handleCloseDialog = useCallback(() => {
    closeBulkDialog(type);
    fetcher.reset();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closeBulkDialog, type]);

  const handleBulkActionSuccess = useCallback(() => {
    if (type === "trash" || type === "archive" || type === "cancel") {
      setSelectedItems([]);

      if (!skipCloseOnSuccess) {
        handleCloseDialog();
      }

      onSuccess && onSuccess();
      return;
    }

    /**
     * On successful bulk action, the data becomes old as we are storing the whole object now.
     * So we have to update the selectedItems data to new one
     *  */
    setSelectedItems((prev) =>
      items.filter((item) => prev.some((i) => i.id === item.id))
    );

    if (!skipCloseOnSuccess) {
      handleCloseDialog();
    }
    onSuccess && onSuccess();
  }, [
    type,
    setSelectedItems,
    skipCloseOnSuccess,
    onSuccess,
    handleCloseDialog,
    items,
  ]);

  useEffect(
    function handleOnSuccess() {
      if (fetcher.data?.error) {
        return;
      }

      /** We have to close the dialog and remove all selected assets when update is success */
      if (fetcher.data?.success) {
        handleBulkActionSuccess();
      }
    },
    [fetcher.data, handleBulkActionSuccess]
  );

  return (
    <DialogPortal>
      <Dialog
        open={isDialogOpen}
        onClose={handleCloseDialog}
        className={tw("bulk-tagging-dialog lg:w-[400px]", className)}
        title={
          <div className="w-full">
            {type !== "cancel" ? (
              <div className="mb-2 inline-flex items-center justify-center rounded-full border-8 border-solid border-primary-50 bg-primary-100 p-2 text-primary-600">
                <Icon icon={type} />
              </div>
            ) : null}
            <div className={tw("mb-5", type === "cancel" && "mt-5")}>
              <h4>{title}</h4>
              <p>
                {description
                  ? description
                  : `Adjust the ${type} of selected (${totalItemsSelected}) assets.`}
              </p>
            </div>
          </div>
        }
      >
        <fetcher.Form
          ref={ref}
          method="post"
          action={actionUrl ? actionUrl : `/api/assets/bulk-update-${type}`}
          className="px-6 pb-6"
        >
          <input
            type="hidden"
            name="currentSearchParams"
            value={searchParams.toString()}
          />

          {selectedItems.map((item, i) => (
            <input
              key={item.id}
              type="hidden"
              name={`${arrayFieldId}[${i}]`}
              value={item.id}
            />
          ))}
          <div className="modal-content-wrapper">
            {typeof children === "function"
              ? children({
                  disabled,
                  handleCloseDialog,
                  fetcherData: fetcher?.data,
                  fetcherError: fetcher?.data?.error?.message,
                  fetcherErrorAdditionalData:
                    fetcher?.data?.error?.additionalData,
                })
              : children}
          </div>
        </fetcher.Form>
      </Dialog>
    </DialogPortal>
  );
});

BulkUpdateDialogContent.displayName = "BulkUpdateDialogContent";

export {
  BulkUpdateDialogTrigger,
  BulkUpdateDialogContent,
  type BulkDialogType,
};
