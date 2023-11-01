import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useNavigation } from "@remix-run/react";
import { parseFormAny, useZorm } from "react-zorm";
import { z } from "zod";
import Input from "~/components/forms/input";

import { Button } from "~/components/shared/button";

import { requireAuthSession, commitAuthSession } from "~/modules/auth";
import { requireOrganisationId } from "~/modules/organization/context.server";
import { createTag } from "~/modules/tag";
import { assertIsPost, isFormProcessing } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { zodFieldIsRequired } from "~/utils/zod";

export const NewTagFormSchema = z.object({
  name: z.string().min(3, "Name is required"),
  description: z.string(),
});

const title = "New Tag";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAuthSession(request);

  const header = {
    title,
  };

  return json({ header });
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export async function action({ request }: LoaderFunctionArgs) {
  const authSession = await requireAuthSession(request);
  const { organizationId } = await requireOrganisationId(authSession, request);
  assertIsPost(request);
  const formData = await request.formData();
  const result = await NewTagFormSchema.safeParseAsync(parseFormAny(formData));

  if (!result.success) {
    return json(
      {
        errors: result.error,
      },
      { status: 400 }
    );
  }

  await createTag({
    ...result.data,
    userId: authSession.userId,
    organizationId,
  });

  sendNotification({
    title: "Tag created",
    message: "Your tag has been created successfully",
    icon: { name: "success", variant: "success" },
    senderId: authSession.userId,
  });

  return redirect(`/tags`, {
    headers: {
      "Set-Cookie": await commitAuthSession(request, { authSession }),
    },
  });
}

export default function NewTag() {
  const zo = useZorm("NewQuestionWizardScreen", NewTagFormSchema);
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);

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
            placeholder="Tag name"
            className="mb-4 lg:mb-0 lg:max-w-[180px]"
            name={zo.fields.name()}
            disabled={disabled}
            error={zo.errors.name()?.message}
            hideErrorText
            autoFocus
            required={zodFieldIsRequired(NewTagFormSchema.shape.name)}
          />
          <Input
            label="Description"
            placeholder="Description (optional)"
            name={zo.fields.description()}
            disabled={disabled}
            data-test-id="tagDescription"
            className="mb-4 lg:mb-0"
            required={zodFieldIsRequired(NewTagFormSchema.shape.description)}
          />
        </div>

        <div className="flex gap-1">
          <Button variant="secondary" to="/tags" size="sm">
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
