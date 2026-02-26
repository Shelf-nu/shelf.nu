import type { Kit } from "@prisma/client";
import { useNavigation } from "react-router";
import { isFormProcessing } from "~/utils/form";
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

export default function RemoveKitFromLocation({
  kit,
}: {
  kit: Pick<Kit, "id" | "name">;
}) {
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="link"
          className="justify-start rounded-sm px-2 py-1.5 text-sm font-medium text-color-700 outline-none hover:bg-slate-100 hover:text-color-700"
          width="full"
          icon="trash"
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
          <AlertDialogTitle>Remove "{kit.name}" from location</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to remove this kit from the location? All
            assets within the kit will also be removed from this location.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <div className="flex justify-center gap-2">
            <AlertDialogCancel asChild>
              <Button variant="secondary">Cancel</Button>
            </AlertDialogCancel>

            <Form method="post">
              <input type="hidden" name="kitId" value={kit.id} />
              <Button name="intent" value="removeKit" disabled={disabled}>
                Remove
              </Button>
            </Form>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
