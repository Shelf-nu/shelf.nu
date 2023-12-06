import type { Template } from "@prisma/client";
import { Form, useLoaderData, useNavigation } from "@remix-run/react";
import { VerticalDotsIcon } from "~/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";
import { isFormProcessing } from "~/utils";
import type { loader } from "../../routes/_layout+/settings.template.index";
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

type TTemplate = Pick<
  Template,
  "id" | "isActive" | "isDefault" | "type" | "name"
>;

export function TemplateActionsDropdown({ template }: { template: TTemplate }) {
  const { defaultTemplates } = useLoaderData<typeof loader>();

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger className="outline-none focus-visible:border-0">
          <i className="inline-block px-3 py-0 text-gray-400 ">
            <VerticalDotsIcon />
          </i>
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
              typeDefault={defaultTemplates[template.type]}
              template={template}
            />
          </DropdownMenuItem>
          <DropdownMenuItem className="px-4 py-3">
            <Button
              to={`${template.id}/edit`}
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
            <input type="hidden" name="templateId" value={template.id} />
            <input
              type="hidden"
              name="isActive"
              value={template.isActive + ""}
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
                className="justify-start text-gray-700 hover:text-gray-700"
                width="full"
              >
                {template.isActive ? "Deactivate" : "Activate"}
              </Button>
            </DropdownMenuItem>
          </Form>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

const MakeDefaultButton = ({
  typeDefault,
  template,
}: {
  typeDefault?: TTemplate;
  template: TTemplate;
}) => {
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);

  return (
    <>
      {template.isDefault || !template.isActive ? (
        <Button
          disabled={true}
          icon="star"
          variant="tertiary"
          className="w-full justify-start border-0 px-0 py-1"
        >
          Make default
        </Button>
      ) : typeDefault && typeDefault.id !== template.id ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              disabled={disabled}
              variant="link"
              className="w-full justify-start rounded-none border-b-2 text-gray-700 hover:bg-gray-100 hover:text-gray-700"
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
                <input
                  type="hidden"
                  name="templateType"
                  value={template.type}
                />
                <input
                  type="hidden"
                  name="isActive"
                  value={template.isActive.toString()}
                />
                <Button
                  type="submit"
                  name="intent"
                  value="makeDefault"
                  role="link"
                  variant="primary"
                >
                  Confirm
                </Button>
              </Form>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : (
        <Form method="post">
          <input type="hidden" name="templateId" value={template.id} />
          <input type="hidden" name="templateType" value={template.type} />
          <input
            type="hidden"
            name="isActive"
            value={template.isActive.toString()}
          />
          <Button
            name="intent"
            value="makeDefault"
            icon="star"
            role="link"
            variant="link"
            className="justify-start  border-b-2 text-gray-700 hover:text-gray-700"
            width="full"
          >
            Make default
          </Button>
        </Form>
      )}
    </>
  );
};
