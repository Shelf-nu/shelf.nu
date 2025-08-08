import { AlertDialog } from "@radix-ui/react-alert-dialog";
import { useDisabled } from "~/hooks/use-disabled";
import { Button } from "../shared/button";
import {
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../shared/modal";

type UnsavedChangesAlertProps = {
  className?: string;
  style?: React.CSSProperties;
  open: boolean;
  type: "assets" | "kits";
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
  onYes?: () => void;
};

export default function UnsavedChangesAlert({
  className,
  style,
  type,
  open,
  onOpenChange,
  onCancel,
  onYes,
}: UnsavedChangesAlertProps) {
  const disabled = useDisabled();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className={className} style={style}>
        <AlertDialogHeader>
          <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
          <AlertDialogDescription>
            You have added some {type} to the booking but haven’t saved it yet.
            Do you want to confirm adding those {type}?
          </AlertDialogDescription>
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
