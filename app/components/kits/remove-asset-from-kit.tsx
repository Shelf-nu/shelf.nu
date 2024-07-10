import type { Asset } from "@prisma/client";
import { Form } from "../custom-form";
import Icon from "../icons/icon";
import { Button } from "../shared/button";
import { ControlledActionButton } from "../shared/controlled-action-button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../shared/modal";

export default function RemoveAssetFromKit({ asset }: { asset: Asset }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <ControlledActionButton
          canUseFeature={asset.status !== "CHECKED_OUT"}
          buttonContent={{
            title: "Remove",
            message:
              "You cannot remove this asset from the kit because it is currently checked out. Please check in the kit first, then try again",
          }}
          buttonProps={{
            variant: "link",
            icon: "trash",
            className:
              "justify-start rounded-sm px-2 py-1.5 text-sm font-medium text-gray-700 outline-none hover:bg-slate-100 hover:text-gray-700",
            width: "full",
          }}
          skipCta={true}
        />
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="mx-auto md:m-0">
            <span className="flex size-12 items-center justify-center rounded-full bg-error-50 p-2 text-error-600">
              <Icon icon="trash" />
            </span>
          </div>
          <AlertDialogTitle>Remove "{asset.title}" from kit</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to remove this asset from the kit? Asset will
            lose any status that is inherited by the kit.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <div className="flex justify-center gap-2">
            <AlertDialogCancel asChild>
              <Button variant="secondary">Cancel</Button>
            </AlertDialogCancel>

            <Form method="post">
              <input type="hidden" name="assetId" value={asset.id} />
              <Button name="intent" value="removeAsset">
                Remove
              </Button>
            </Form>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
