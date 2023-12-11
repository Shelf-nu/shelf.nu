import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useAtomValue } from "jotai";
import { parseFormAny } from "react-zorm";

import { dynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import {
  CustomFieldForm,
  NewCustomFieldFormSchema,
} from "~/components/custom-fields/form";
import Header from "~/components/layout/header";

import { requireAuthSession, commitAuthSession } from "~/modules/auth";
import { createCustomField } from "~/modules/custom-field";
import { requireOrganisationId } from "~/modules/organization/context.server";
import { assertUserCanCreateMoreCustomFields } from "~/modules/tier";

import { assertIsPost } from "~/utils";

import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { setCookie } from "~/utils/cookies.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";

const title = "New Custom Field";

export async function loader({ request }: LoaderFunctionArgs) {
  const authSession = await requireAuthSession(request);
  const { organizationId } = await requireOrganisationId(authSession, request);
  const { userId } = authSession;

  await assertUserCanCreateMoreCustomFields({ userId, organizationId });

  const header = {
    title,
  };

  return json({
    header,
  });
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data?.header?.title) : "" },
];

export const handle = {
  breadcrumb: () => <span>{title}</span>,
};

export async function action({ request }: LoaderFunctionArgs) {
  const authSession = await requireAuthSession(request);
  const { organizationId } = await requireOrganisationId(authSession, request);
  assertIsPost(request);
  await assertUserCanCreateMoreCustomFields({
    userId: authSession.userId,
    organizationId,
  });

  const formData = await request.formData();
  const result = await NewCustomFieldFormSchema.safeParseAsync(
    parseFormAny(formData)
  );

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

  const { name, helpText, required, type, active, options } = result.data;

  const rsp = await createCustomField({
    name,
    helpText,
    required,
    type,
    active,
    organizationId,
    userId: authSession.userId,
    options,
  });

  if (rsp.error) {
    return json(
      {
        errors: { name: rsp.error },
      },
      {
        status: 400,
        headers: [setCookie(await commitAuthSession(request, { authSession }))],
      }
    );
  }

  sendNotification({
    title: "Custom Field created",
    message: "Your Custom Field has been created successfully",
    icon: { name: "success", variant: "success" },
    senderId: authSession.userId,
  });

  return redirect(`/settings/custom-fields`, {
    headers: {
      "Set-Cookie": await commitAuthSession(request, { authSession }),
    },
  });
}

export default function NewCustomFieldPage() {
  const title = useAtomValue(dynamicTitleAtom);

  return (
    <>
      <Header title={title ? title : "Untitled custom field"} />
      <div>
        <CustomFieldForm />
      </div>
    </>
  );
}
