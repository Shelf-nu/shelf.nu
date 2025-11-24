import type { loader } from "~/routes/_layout+/kits.$kitId";
import {
  RelinkQrCodeDialog,
  type RelinkQrCodeActionData,
} from "../qr/relink-qr-code-dialog";
import { useActionData, useLoaderData } from "react-router";

type RelinkQrCodeDialogProps = {
  open: boolean;
  onClose: () => void;
};

export default function KitRelinkQrCodeDialog({
  open,
  onClose,
}: RelinkQrCodeDialogProps) {
  const { kit } = useLoaderData<typeof loader>();
  const actionData = useActionData<RelinkQrCodeActionData>();

  return (
    <RelinkQrCodeDialog
      open={open}
      onClose={onClose}
      itemName={kit.name}
      currentQrId={kit.qrCodes[0]?.id}
      itemLabel="kit"
      actionData={actionData}
    />
  );
}
