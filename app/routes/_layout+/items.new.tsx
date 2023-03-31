import { useState } from "react";
import type { ChangeEvent } from "react";

import type { LoaderArgs, V2_MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useNavigation } from "@remix-run/react";
import { parseFormAny, useZorm } from "react-zorm";
import { z } from "zod";

import FormRow from "~/components/forms/form-row";
import Input from "~/components/forms/input";
import Header from "~/components/layout/header";

import { Button } from "~/components/shared/button";
import { FileDropzone } from "~/components/shared/file-dropzone";

import { requireAuthSession, commitAuthSession } from "~/modules/auth";
import { createItem } from "~/modules/item";
import { assertIsPost, isFormProcessing } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export const NewItemFormSchema = z.object({
  title: z.string().min(2, "Title is required"),
  description: z.string(),
});

const title = "New Item";

export async function loader({ request }: LoaderArgs) {
  await requireAuthSession(request);

  const header = {
    title,
  };

  return json({ header });
}

export const meta: V2_MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data.header.title) },
];

export const handle = {
  breadcrumb: () => <span>{title}</span>,
};

export async function action({ request }: LoaderArgs) {
  const authSession = await requireAuthSession(request);
  assertIsPost(request);
  const formData = await request.formData();
  const result = await NewItemFormSchema.safeParseAsync(parseFormAny(formData));

  if (!result.success) {
    return json(
      {
        errors: result.error,
      },
      {
        status: 400,
        headers: {
          "Set-Cookie": await commitAuthSession(request, { authSession }),
        },
      }
    );
  }

  const { title, description } = result.data;

  const item = await createItem({
    title,
    description,
    userId: authSession.userId,
  });

  return redirect(`/items/${item.id}`, {
    headers: {
      "Set-Cookie": await commitAuthSession(request, { authSession }),
    },
  });
}

export default function NewItemPage() {
  const [title, setTitle] = useState<string>("Untitled item");
  const zo = useZorm("NewQuestionWizardScreen", NewItemFormSchema);
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);

  const handleTitleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setTitle(() => event.target.value);
  };

  return (
    <>
      <Header title={title} />
      <div>
        <Form ref={zo.ref} method="post" className="flex w-full flex-col gap-2">
          <FormRow rowLabel={"Name"} className="border-b-0">
            <Input
              label="Name"
              hideLabel
              name={zo.fields.title()}
              disabled={disabled}
              error={zo.errors.title()?.message}
              autoFocus
              className="w-full max-w-[640px]"
              onChange={handleTitleChange}
            />
          </FormRow>
          {/* 
          <FormRow rowLabel={"Main image"}>
            <FileDropzone />
          </FormRow> */}

          <div>
            <FormRow
              rowLabel="Description"
              subHeading="This is the initial object description. It will be shown on the item’s overview page. You can always change it."
            >
              <Input
                label="Description"
                hideLabel
                inputType="textarea"
                role="textbox"
                name={zo.fields.description()}
                rows={8}
                className="w-full max-w-[800px]"
                disabled={disabled}
                error={zo.errors.description()?.message}
                data-test-id="itemDescription"
              />
            </FormRow>
          </div>

          <div className="text-right">
            <Button type="submit" disabled={disabled}>
              Save
            </Button>
          </div>
        </Form>
      </div>
    </>
  );
}
