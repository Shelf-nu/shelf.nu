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
};

export default function UnsavedChangesAlert({
  className,
  style,
  open,
  onOpenChange,
  onCancel,
  onYes,
  children,
}: UnsavedChangesAlertProps) {
  const disabled = useDisabled();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className={className} style={style}>
        <AlertDialogHeader>
          <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
          <AlertDialogDescription>{children}</AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <div className="flex justify-center gap-2">
            <AlertDialogCancel asChild>
              <Button
                variant="secondary"
                onClick={onCancel}
                disabled={disabled}
              >
                No, discard changes
              </Button>
            </AlertDialogCancel>

            <Button onClick={onYes} disabled={disabled} variant="primary">
              Yes, confirm change
            </Button>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
