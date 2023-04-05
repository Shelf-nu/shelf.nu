import { useState } from "react";
import type { ChangeEvent } from "react";

import type { LoaderArgs, V2_MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useNavigation } from "@remix-run/react";
import { parseFormAny, useZorm } from "react-zorm";
import { z } from "zod";
import { ColorInput } from "~/components/forms/color-input";
import Input from "~/components/forms/input";

import { Button } from "~/components/shared/button";

import { requireAuthSession, commitAuthSession } from "~/modules/auth";
import { assertIsPost, isFormProcessing } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export const NewCategoryFormSchema = z.object({
  name: z.string().min(3, "Name is required"),
  description: z.string(),
  color: z.string().regex(/^#/).min(7),
});

const title = "New category";

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

export async function action({ request }: LoaderArgs) {
  const authSession = await requireAuthSession(request);
  assertIsPost(request);

  return redirect("/categories", {
    headers: {
      "Set-Cookie": await commitAuthSession(request, { authSession }),
    },
  });
}

export default function NewItemPage() {
  const zo = useZorm("NewQuestionWizardScreen", NewCategoryFormSchema);
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);

  return (
    <>
      <Form
        method="post"
        className="flex items-end justify-between gap-3 rounded-[12px] border border-gray-200 bg-white px-6 py-5"
        ref={zo.ref}
      >
        <div className="flex items-end gap-3">
          <Input
            label="Name"
            placeholder="Category name"
            className="max-w-[180px]"
            name={zo.fields.name()}
            disabled={disabled}
            error={zo.errors.name()?.message}
            hideErrorText
            autoFocus
          />
          <Input
            label="Description"
            placeholder="Description (optional)"
            name={zo.fields.description()}
            disabled={disabled}
            autoFocus
          />
          <ColorInput
            name={zo.fields.color()}
            disabled={disabled}
            error={zo.errors.color()?.message}
            hideErrorText
          />
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
