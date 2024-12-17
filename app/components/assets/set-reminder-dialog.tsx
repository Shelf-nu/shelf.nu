import { Dialog, DialogPortal } from "../layout/dialog";
import SetReminderForm from "./set-reminder-form/set-reminder-form";

type SetReminderDialogProps = {
  open: boolean;
  onClose: () => void;
};

export default function SetReminderDialog({
  open,
  onClose,
}: SetReminderDialogProps) {
  return (
    <DialogPortal>
      <Dialog
        open={open}
        onClose={onClose}
        className="md:w-[800px]"
        headerClassName="border-b"
        title={
          <div className="-mb-3 w-full pb-6">
            <h3>Set Reminder</h3>
            <p className="text-gray-600">
              Notify you and / or others via email about this asset.
            </p>
          </div>
        }
      >
        <SetReminderForm onCancel={onClose} />
      </Dialog>
    </DialogPortal>
  );
}
