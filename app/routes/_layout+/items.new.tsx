import type { LoaderArgs, V2_MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useNavigation } from "@remix-run/react";
import { useAtom, useAtomValue } from "jotai";
import { parseFormAny, useZorm } from "react-zorm";
import { z } from "zod";
import {
  fileErrorAtom,
  titleAtom,
  updateTitleAtom,
  validateFileAtom,
} from "~/atoms/items.new";
import { CategorySelect } from "~/components/category/category-select";

import FormRow from "~/components/forms/form-row";
import Input from "~/components/forms/input";
import Header from "~/components/layout/header";

import { MarkdownEditor } from "~/components/markdown";
import { Button } from "~/components/shared/button";
import { requireAuthSession, commitAuthSession } from "~/modules/auth";
import { getCategories } from "~/modules/category";
import { createItem, updateItemMainImage } from "~/modules/item";
import { assertIsPost, isFormProcessing } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export const NewItemFormSchema = z.object({
  title: z.string().min(2, "Title is required"),
  description: z.string(),
  category: z.string(),
});

const title = "New Item";

export async function loader({ request }: LoaderArgs) {
  const { userId } = await requireAuthSession(request);
  const { categories } = await getCategories({
    userId,
    perPage: 100,
  });

  const header = {
    title,
  };

  return json({ header, categories });
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

  const { title, description, category } = result.data;

  const item = await createItem({
    title,
    description,
    userId: authSession.userId,
    categoryId: category,
  });

  // Not sure how to handle this failign as the item is already created
  await updateItemMainImage({ request, itemId: item.id });

  return redirect(`/items/${item.id}`, {
    headers: {
      "Set-Cookie": await commitAuthSession(request, { authSession }),
    },
  });
}

export default function NewItemPage() {
  const zo = useZorm("NewQuestionWizardScreen", NewItemFormSchema);
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);

  const title = useAtomValue(titleAtom);
  const fileError = useAtomValue(fileErrorAtom);
  const [, validateFile] = useAtom(validateFileAtom);
  const [, updateTitle] = useAtom(updateTitleAtom);

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
              onChange={updateTitle}
              className="w-full"
            />
          </FormRow>

          <FormRow rowLabel={"Main image"}>
            <div>
              <p>Accepts PNG, JPG or JPEG (max.4 MB)</p>
              <Input
                disabled={disabled}
                accept="image/png,.png,image/jpeg,.jpg,.jpeg"
                name="mainImage"
                type="file"
                onChange={validateFile}
                label={"mainImage"}
                hideLabel
                error={fileError}
                className="mt-2"
                inputClassName="border-0 shadow-none p-0 rounded-none"
              />
            </div>
          </FormRow>

          <FormRow
            rowLabel={"Cateogry"}
            subHeading="Make it unique. Each item can have 1 category. It will show on your index."
          >
            <CategorySelect />
          </FormRow>

          <div>
            <FormRow
              rowLabel="Description"
              subHeading={
                <p>
                  This is the initial object description. It will be shown on
                  the item’s overview page. You can always change it. This field
                  supports{" "}
                  <Link
                    to="https://www.markdownguide.org/cheat-sheet"
                    target="_blank"
                    className="text-gray-800 underline"
                    rel="nofollow noopener noreferrer"
                  >
                    markdown
                  </Link>
                  .
                </p>
              }
            >
              <MarkdownEditor
                label={zo.fields.description()}
                name={zo.fields.description()}
                disabled={disabled}
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
