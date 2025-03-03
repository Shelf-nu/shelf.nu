import { useEffect, useState } from "react";
import type { CustodyAgreement } from "@prisma/client";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
import { EllipsisVerticalIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";

import { isFormProcessing } from "~/utils/form";
import { tw } from "~/utils/tw";
import type {
  loader,
  action,
} from "../../routes/_layout+/settings.template.index";
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

type TCustodyAgreement = Pick<
  CustodyAgreement,
  "id" | "isActive" | "isDefault" | "type" | "name"
>;

export function TemplateActionsDropdown({
  agreement,
}: {
  agreement: TCustodyAgreement;
}) {
  const { defaultTemplates } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger className="outline-none focus-visible:border-0">
        <EllipsisVerticalIcon className="size-4 text-gray-400" />
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        className="order w-[180px] rounded-md bg-white p-0 text-right"
      >
        <DropdownMenuItem
          onSelect={(e) => e.preventDefault()}
          className="px-4 py-3"
        >
          <MakeDefaultButton
            typeDefault={defaultTemplates[agreement.type]}
            template={agreement}
          />
        </DropdownMenuItem>
        <DropdownMenuItem className="px-4 py-3">
          <Button
            to={`${agreement.id}/edit`}
            icon="pen"
            role="link"
            variant="link"
            className="justify-start text-gray-700 hover:text-gray-700"
            width="full"
          >
            Edit
          </Button>
        </DropdownMenuItem>
        <Form method="post">
          <input type="hidden" name="templateId" value={agreement.id} />
          <input
            type="hidden"
            name="isActive"
            value={agreement.isActive ? "yes" : "no"}
          />
          <DropdownMenuItem
            onSelect={(e) => e.preventDefault()}
            className="px-4 py-3"
          >
            <Button
              name="intent"
              value="toggleActive"
              type="submit"
              icon="deactivate"
              role="link"
              variant="link"
              className={tw(
                "justify-start text-gray-700 hover:text-gray-700",
                agreement.isDefault || disabled
                  ? "pointer-events-none border-gray-300 text-gray-300"
                  : ""
              )}
              width="full"
              disabled={disabled || agreement.isDefault}
            >
              {agreement.isActive ? "Deactivate" : "Activate"}
            </Button>
          </DropdownMenuItem>
        </Form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const MakeDefaultButton = ({
  typeDefault,
  template,
}: {
  /** The default template for the current type */
  typeDefault: TCustodyAgreement;
  /** The template to set as default */
  template: TCustodyAgreement;
}) => {
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);

  /**
   * We need to control this dialog because we have multiple and we need to manually close it after sucessfull submition of the form
   */
  const [open, setOpen] = useState(false);
  const actionData = useActionData<typeof action>();

  /**
   * Close the dialog when the default template is changed based on action response
   */
  useEffect(() => {
    if (actionData?.changedDefault) {
      setOpen(false);
    }
  }, [actionData]);

  return (
    <>
      <AlertDialog key={template.id} open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button
            disabled={disabled || template.isDefault || !template.isActive}
            variant="link"
            className={tw(
              "w-full justify-start rounded-none border-b-2 text-gray-700 hover:bg-gray-100 hover:text-gray-700",
              disabled || template.isDefault || !template.isActive
                ? "pointer-events-none border-gray-300 text-gray-300"
                : ""
            )}
            icon={"star"}
            title={"Make default"}
          >
            Make default
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent className="relative w-full">
          <AlertDialogHeader>
            <AlertDialogTitle>Change default template?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-semibold">{typeDefault.name}</span> is
              already set as the default template for this type. Are you sure
              you want to set{" "}
              <span className="font-semibold">{template.name}</span> as the
              default template?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="secondary">Cancel</Button>
            </AlertDialogCancel>
            <Form method="post">
              <input type="hidden" name="templateId" value={template.id} />
              <input type="hidden" name="templateType" value={template.type} />
              <Button
                type="submit"
                name="intent"
                value="makeDefault"
                role="link"
                variant="primary"
                disabled={disabled}
              >
                Confirm
              </Button>
            </Form>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
