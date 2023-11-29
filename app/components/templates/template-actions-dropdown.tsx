import { useState } from "react";
import type { Template } from "@prisma/client";
import { useFetcher, useLoaderData, useSubmit } from "@remix-run/react";
import { TrashIcon, VerticalDotsIcon } from "~/components/icons";
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
  const submit = useSubmit();
  const { items } = useLoaderData<typeof loader>();

  const [defaultItem] = useState<Map<string, TTemplate>>(() => {
    const map = new Map<string, TTemplate>();
    items.forEach((item) => {
      if (item.isDefault) map.set(item.type, item);
    });
    return map;
  });

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
              typeDefault={defaultItem.get(template.type)}
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
          <DropdownMenuItem className="px-4 py-3">
            {/* <Form method="post"> */}
            {/* <input type="submit" value={"submit"} /> */}
            <Button
              onClick={() =>
                submit(null, {
                  method: "post",
                  action: `?index&isActive=${template.isActive}&templateId=${template.id}&action=toggle-active`,
                })
              }
              type="submit"
              icon="deactivate"
              role="link"
              variant="link"
              className="justify-start text-gray-700 hover:text-gray-700"
              width="full"
            >
              {template.isActive ? "Deactivate" : "Activate"}
            </Button>
            {/* </Form> */}
          </DropdownMenuItem>
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
  const fetcher = useFetcher();
  const disabled = isFormProcessing(fetcher.state);
  const submit = useSubmit();

  const handleMakeDefault = () => {
    submit(null, {
      method: "post",
      action: `?index&isActive=${template.isActive}&templateId=${template.id}&templateType=${template.type}&action=make-default`,
    });
  };

  return (
    <>
      {template.isDefault || !template.isActive ? (
        <Button
          disabled={true}
          icon="star"
          variant="tertiary"
          className="border-0"
          width="full"
        >
          Make default
        </Button>
      ) : typeDefault && typeDefault.id !== template.id ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              disabled={disabled}
              variant="link"
              type="submit"
              className="w-full justify-start rounded-none border-b-2 text-gray-700 hover:bg-gray-100 hover:text-gray-700"
              icon={"star"}
              title={"Make default"}
            >
              Make default
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="relative w-full">
            <AlertDialogHeader>
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-error-50 p-2 text-error-600">
                <TrashIcon />
              </span>
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
              {/* <Form method="delete" action="/categories"> */}
              {/* <input type="hidden" name="id" value={"WQfegrht"} /> */}
              <Button
                className="border-error-600 bg-error-600 hover:border-error-800 hover:bg-error-800"
                type="submit"
                onClick={handleMakeDefault}
              >
                Confirm
              </Button>
              {/* </Form> */}
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : (
        <Button
          icon="star"
          role="link"
          variant="link"
          onClick={handleMakeDefault}
          className="justify-start  border-b-2 text-gray-700 hover:text-gray-700"
          width="full"
        >
          Make default
        </Button>
      )}
    </>
  );
};
