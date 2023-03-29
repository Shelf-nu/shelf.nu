import * as React from "react";

import type { LoaderArgs, V2_MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useTransition } from "@remix-run/react";
import { parseFormAny, useZorm } from "react-zorm";
import { z } from "zod";
import Input from "~/components/forms/input";
import { Button } from "~/components/shared/button";

import { requireAuthSession, commitAuthSession } from "~/modules/auth";
import { createItem } from "~/modules/item";
import { assertIsPost, isFormProcessing } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export const NewItemFormSchema = z.object({
  title: z.string().min(2, "require-title"),
  description: z.string().min(5, "require-description"),
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
  assertIsPost(request);
  const authSession = await requireAuthSession(request);
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
  const zo = useZorm("NewQuestionWizardScreen", NewItemFormSchema);
  const transition = useTransition();
  const disabled = isFormProcessing(transition.state);

  return (
    <div>
      <Form ref={zo.ref} method="post" className="flex w-full flex-col gap-2">
        <div className="mt-6">
          <Input
            label="Title"
            name={zo.fields.title()}
            disabled={disabled}
            error={zo.errors.title()?.message}
          />
        </div>

        <div>
          <Input
            label="Description"
            inputType="textarea"
            name={zo.fields.description()}
            rows={8}
            className="w-full"
            disabled={disabled}
            error={zo.errors.description()?.message}
          />
        </div>

        <div className="text-right">
          <Button type="submit" disabled={disabled}>
            Save
          </Button>
        </div>
      </Form>
    </div>
  );
}
