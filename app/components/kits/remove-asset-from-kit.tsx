import type { Asset } from "@prisma/client";
import { Form } from "../custom-form";
import Icon from "../icons/icon";
import { Button } from "../shared/button";
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
        <Button
          variant="link"
          icon="trash"
          className="justify-start rounded-sm px-2 py-1.5 text-sm font-medium text-gray-700 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-slate-100 hover:text-gray-700"
          width="full"
        >
          Remove
        </Button>
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
