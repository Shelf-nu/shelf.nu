import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData, useNavigation } from "@remix-run/react";
import { parseFormAny, useZorm } from "react-zorm";
import { z } from "zod";
import { ColorInput } from "~/components/forms/color-input";
import Input from "~/components/forms/input";

import { Button } from "~/components/shared/button";

import { requireAuthSession, commitAuthSession } from "~/modules/auth";
import { createCategory } from "~/modules/category";
import { requireOrganisationId } from "~/modules/organization/context.server";
import { assertIsPost, getRandomColor, isFormProcessing } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { zodFieldIsRequired } from "~/utils/zod";

export const NewCategoryFormSchema = z.object({
  name: z.string().min(3, "Name is required"),
  description: z.string(),
  color: z.string().regex(/^#/).min(7),
});

const title = "New category";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAuthSession(request);

  const colorFromServer = getRandomColor();

  const header = {
    title,
  };

  return json({ header, colorFromServer });
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export async function action({ request }: LoaderFunctionArgs) {
  const authSession = await requireAuthSession(request);
  const { organizationId } = await requireOrganisationId(authSession, request);
  assertIsPost(request);
  const formData = await request.formData();
  const result = await NewCategoryFormSchema.safeParseAsync(
    parseFormAny(formData)
  );

  if (!result.success) {
    return json(
      {
        errors: result.error,
      },
      { status: 400 }
    );
  }

  await createCategory({
    ...result.data,
    userId: authSession.userId,
    organizationId,
  });

  sendNotification({
    title: "Category created",
    message: "Your category has been created successfully",
    icon: { name: "success", variant: "success" },
    senderId: authSession.userId,
  });

  return redirect(`/categories`, {
    headers: {
      "Set-Cookie": await commitAuthSession(request, { authSession }),
    },
  });
}

export default function NewCategory() {
  const zo = useZorm("NewQuestionWizardScreen", NewCategoryFormSchema);
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);
  const { colorFromServer } = useLoaderData<typeof loader>();

  return (
    <>
      <Form
        method="post"
        className="block rounded-[12px] border border-gray-200 bg-white px-6 py-5 lg:flex lg:items-end lg:justify-between lg:gap-3"
        ref={zo.ref}
      >
        <div className="gap-3 lg:flex lg:items-end">
          <Input
            label="Name"
            placeholder="Category name"
            className="mb-4 lg:mb-0 lg:max-w-[180px]"
            name={zo.fields.name()}
            disabled={disabled}
            error={zo.errors.name()?.message}
            hideErrorText
            autoFocus
            required={zodFieldIsRequired(NewCategoryFormSchema.shape.name)}
          />
          <Input
            label="Description"
            placeholder="Description (optional)"
            name={zo.fields.description()}
            disabled={disabled}
            data-test-id="categoryDescription"
            className="mb-4 lg:mb-0"
            required={zodFieldIsRequired(
              NewCategoryFormSchema.shape.description
            )}
          />
          <div className="mb-6 lg:mb-0">
            <ColorInput
              name={zo.fields.color()}
              disabled={disabled}
              error={zo.errors.color()?.message}
              hideErrorText
              colorFromServer={colorFromServer}
              required={zodFieldIsRequired(NewCategoryFormSchema.shape.color)}
            />
          </div>
        </div>

        <div className="flex gap-1">
          <Button variant="secondary" to="/categories" size="sm">
            Cancel
          </Button>
          <Button type="submit" size="sm">
            Create
          </Button>
        </div>
      </Form>
    </>
  );
}
