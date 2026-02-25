import { Button } from "~/components/shared/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/shared/modal";
import { useDisabled } from "~/hooks/use-disabled";
import { tw } from "~/utils/tw";
import { Form } from "../custom-form";
import { TrashIcon } from "../icons/library";

type RemoveAssetFromAuditProps = {
  auditAssetId: string;
  assetTitle: string;
};

export const RemoveAssetFromAudit = ({
  auditAssetId,
  assetTitle,
}: RemoveAssetFromAuditProps) => {
  const disabled = useDisabled();

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="link"
          icon="trash"
          className={tw(
            "justify-start whitespace-nowrap rounded-sm px-2 py-1.5 text-sm font-medium text-gray-700 outline-none hover:bg-slate-100 hover:text-gray-700"
          )}
          width="full"
          disabled={disabled}
        >
          Remove from audit
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="mx-auto md:m-0">
            <span className="flex size-12 items-center justify-center rounded-full bg-error-50 p-2 text-error-600">
              <TrashIcon />
            </span>
          </div>
          <AlertDialogTitle>Remove {assetTitle} from audit</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to remove this asset from the audit? This
            action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <div className="flex justify-center gap-2">
            <AlertDialogCancel asChild>
              <Button variant="secondary" disabled={disabled}>
                Cancel
              </Button>
            </AlertDialogCancel>

            <Form method="post">
              <input type="hidden" name="auditAssetId" value={auditAssetId} />
              <input type="hidden" name="intent" value="remove-asset" />
              <Button
                className="border-error-600 bg-error-600 hover:border-error-800 hover:!bg-error-800"
                type="submit"
                disabled={disabled}
              >
                Remove
              </Button>
            </Form>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
