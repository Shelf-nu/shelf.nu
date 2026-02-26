import { useActionData, useLoaderData } from "react-router";
import type { loader } from "~/routes/_layout+/assets.$assetId";
import {
  RelinkQrCodeDialog,
  type RelinkQrCodeActionData,
} from "../qr/relink-qr-code-dialog";

type RelinkQrCodeDialogProps = {
  open: boolean;
  onClose: () => void;
};

export default function AssetRelinkQrCodeDialog({
  open,
  onClose,
}: RelinkQrCodeDialogProps) {
  const { asset } = useLoaderData<typeof loader>();
  const actionData = useActionData<RelinkQrCodeActionData>();

  return (
    <RelinkQrCodeDialog
      open={open}
      onClose={onClose}
      itemName={asset.title}
      currentQrId={asset.qrCodes[0]?.id}
      itemLabel="asset"
      actionData={actionData}
    />
  );
}
