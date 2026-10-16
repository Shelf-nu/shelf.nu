import type { CSSProperties, ReactNode } from "react";
import { AlertDialog } from "@radix-ui/react-alert-dialog";
import { useDisabled } from "~/hooks/use-disabled";
import { Button } from "./shared/button";
import {
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./shared/modal";

type UnsavedChangesAlertProps = {
  className?: string;
  style?: CSSProperties;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
  onYes?: () => void;
  children: ReactNode;
  /** Dialog title. Default "Unsaved changes". */
  title?: string;
  /** Label of the secondary button that runs `onCancel`. */
  cancelLabel?: string;
  /** Label of the primary button that runs `onYes`. */
  confirmLabel?: string;
};

/**
 * Confirmation dialog shown when unsaved work is about to be lost.
 *
 * The secondary button runs `onCancel` and closes the dialog; the primary
 * button runs `onYes`. Labels default to the manage-* tab-switch wording.
 *
 * @param props - See {@link UnsavedChangesAlertProps}
 */

export default function UnsavedChangesAlert({
  className,
  style,
  open,
  onOpenChange,
  onCancel,
  onYes,
  children,
  title = "Unsaved changes",
  cancelLabel = "No, discard changes",
  confirmLabel = "Yes, confirm change",
}: UnsavedChangesAlertProps) {
  const disabled = useDisabled();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className={className} style={style}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{children}</AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <div className="flex justify-center gap-2">
            <AlertDialogCancel asChild>
              <Button
                type="button"
                variant="secondary"
                onClick={onCancel}
                disabled={disabled}
              >
                {cancelLabel}
              </Button>
            </AlertDialogCancel>

            <Button
              type="button"
              onClick={onYes}
              disabled={disabled}
              variant="primary"
            >
              {confirmLabel}
            </Button>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
