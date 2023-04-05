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
import { ItemImageUpload } from "~/components/shared/file-dropzone/item-image-upload";

import { requireAuthSession, commitAuthSession } from "~/modules/auth";
import { createItem, updateItemMainImage } from "~/modules/item";
import { assertIsPost, isFormProcessing } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export const NewItemFormSchema = z.object({
  title: z.string().min(2, "Title is required"),
  // mainImage:
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

  /** Here we need to clone the request as we need 2 different streams:
   * 1. Access form data for creating item
   * 2. Access form data via upload handler to be able to upload the file
   *
   * This solution is based on : https://github.com/remix-run/remix/issues/3971#issuecomment-1222127635
   */
  const clonedRequest = request.clone();

  const formData = await clonedRequest.formData();
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

  // @ts-ignore
  const { error } = await updateItemMainImage({ request, itemId: item.id });

  // Not sure how to handle this as the item is already created
  // if (error) {
  //   return json(
  //     { error },
  //     {
  //       status: 500,
  //     }
  //   );
  // }

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
        <Form
          ref={zo.ref}
          method="post"
          className="flex w-full flex-col gap-2"
          encType="multipart/form-data"
        >
          <FormRow rowLabel={"Name"} className="border-b-0">
            <Input
              label="Name"
              hideLabel
              name={zo.fields.title()}
              disabled={disabled}
              error={zo.errors.title()?.message}
              autoFocus
              onChange={handleTitleChange}
              className="w-full"
            />
          </FormRow>

          <FormRow rowLabel={"Main image"}>
            <ItemImageUpload />
          </FormRow>

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
                className="w-full"
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
