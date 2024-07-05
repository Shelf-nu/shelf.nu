import { forwardRef, useCallback, useEffect } from "react";
import { useFetcher, useSearchParams } from "@remix-run/react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  bulkDialogAtom,
  closeBulkDialogAtom,
  openBulkDialogAtom,
} from "~/atoms/bulk-update-dialog";
import {
  selectedBulkItemsAtom,
  selectedBulkItemsCountAtom,
  setSelectedBulkItemsAtom,
} from "~/atoms/list";
import type { action } from "~/routes/api+/assets.bulk-update-location";
import { isFormProcessing } from "~/utils/form";
import { tw } from "~/utils/tw";
import Icon from "../icons/icon";
import { Dialog, DialogPortal } from "../layout/dialog";
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
  | "trash";

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
          "w-full justify-start px-4  py-3 text-gray-700 hover:text-gray-700"
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
};

type BulkUpdateDialogContentProps = CommonBulkDialogProps & {
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
};

/** This component is basically the body of the Dialog */
const BulkUpdateDialogContent = forwardRef<
  React.ElementRef<"form">,
  BulkUpdateDialogContentProps
>(function (
  {
    type,
    children,
    onSuccess,
    title = `Update ${type}`,
    description,
    actionUrl,
    arrayFieldId,
  },
  ref
) {
  const fetcher = useFetcher<typeof action>();
  const disabled = isFormProcessing(fetcher.state);

  const [searchParams] = useSearchParams();

  const bulkDialogOpenState = useAtomValue(bulkDialogAtom);
  const closeBulkDialog = useSetAtom(closeBulkDialogAtom);

  const selectedAssets = useAtomValue(selectedBulkItemsAtom);
  const setSelectedAssets = useSetAtom(setSelectedBulkItemsAtom);
  const itemsSelected = useAtomValue(selectedBulkItemsCountAtom);

  const isDialogOpen = bulkDialogOpenState[type] === true;

  const handleCloseDialog = useCallback(() => {
    closeBulkDialog(type);
  }, [closeBulkDialog, type]);

  useEffect(
    function handleOnSuccess() {
      if (fetcher.data?.error) {
        return;
      }

      /** We have to close the dialog and remove all selected assets when update is success */
      if (fetcher.data?.success) {
        if (type === "trash") {
          setSelectedAssets([]);
        }
        handleCloseDialog();
        onSuccess && onSuccess();
      }
    },
    [fetcher, handleCloseDialog, onSuccess, setSelectedAssets, type]
  );

  return (
    <DialogPortal>
      <Dialog
        open={isDialogOpen}
        onClose={handleCloseDialog}
        className="lg:w-[400px]"
        title={
          <div className="w-full">
            <div className="mb-2 inline-flex items-center justify-center rounded-full border-8 border-solid border-primary-50 bg-primary-100 p-2 text-primary-600">
              <Icon icon={type} />
            </div>
            <div className="mb-5">
              <h4>{title}</h4>
              <p>
                {description
                  ? description
                  : `Adjust the ${type} of selected (${itemsSelected}) assets.`}
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

          {selectedAssets.map((assetId, i) => (
            <input
              key={assetId}
              type="hidden"
              name={`${arrayFieldId}[${i}]`}
              value={assetId}
            />
          ))}
          <div className="modal-content-wrapper">
            {typeof children === "function"
              ? children({
                  disabled,
                  handleCloseDialog,
                  fetcherError: fetcher?.data?.error?.message,
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
