import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
import { parseFormAny, useZorm } from "react-zorm";
import { z } from "zod";
import Input from "~/components/forms/input";

import { Button } from "~/components/shared/button";

import { requireAuthSession, commitAuthSession } from "~/modules/auth";
import { getTag, updateTag } from "~/modules/tag";
import { assertIsPost, getRequiredParam, isFormProcessing } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { setCookie } from "~/utils/cookies.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { zodFieldIsRequired } from "~/utils/zod";

export const UpdateTagFormSchema = z.object({
  name: z.string().min(3, "Name is required"),
  description: z.string(),
});

const title = "Edit Tag";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAuthSession(request);

  const id = getRequiredParam(params, "tagId");
  const tag = await getTag({ id });

  const header = {
    title,
  };

  return json({ header, tag });
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export async function action({ request, params }: LoaderFunctionArgs) {
  const authSession = await requireAuthSession(request);
  assertIsPost(request);
  const formData = await request.formData();
  const result = await UpdateTagFormSchema.safeParseAsync(
    parseFormAny(formData)
  );

  const id = getRequiredParam(params, "tagId");

  if (!result.success) {
    return json(
      {
        errors: result.error,
      },
      {
        status: 400,
        headers: [setCookie(await commitAuthSession(request, { authSession }))],
      }
    );
  }

  const rsp = await updateTag({
    ...result.data,
    id,
  });

  if (rsp?.error) {
    return json(
      {
        errors: rsp.error,
      },
      {
        status: 400,
        headers: [setCookie(await commitAuthSession(request, { authSession }))],
      }
    );
  }

  sendNotification({
    title: "Tag Updated",
    message: "Your tag has been updated successfully",
    icon: { name: "success", variant: "success" },
    senderId: authSession.userId,
  });

  return redirect(`/tags`, {
    headers: [setCookie(await commitAuthSession(request, { authSession }))],
  });
}

export default function EditTag() {
  const zo = useZorm("NewQuestionWizardScreen", UpdateTagFormSchema);
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);
  const { tag } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return tag ? (
    <>
      <Form
        method="post"
        className="block rounded-[12px] border border-gray-200 bg-white px-6 py-5 "
        ref={zo.ref}
      >
        <div className="lg:flex lg:items-end lg:justify-between lg:gap-3">
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
              required={zodFieldIsRequired(UpdateTagFormSchema.shape.name)}
              defaultValue={tag.name}
            />
            <Input
              label="Description"
              placeholder="Description (optional)"
              name={zo.fields.description()}
              disabled={disabled}
              data-test-id="tagDescription"
              className="mb-4 lg:mb-0"
              required={zodFieldIsRequired(
                UpdateTagFormSchema.shape.description
              )}
              defaultValue={tag.description || undefined}
            />
          </div>

          <div className="flex gap-1">
            <Button variant="secondary" to="/tags" size="sm">
              Cancel
            </Button>
            <Button type="submit" size="sm">
              Update
            </Button>
          </div>
        </div>

        {actionData?.errors ? (
          <div className="mt-3 text-sm text-error-500">
            {actionData?.errors?.message}
          </div>
        ) : null}
      </Form>
    </>
  ) : null;
}
