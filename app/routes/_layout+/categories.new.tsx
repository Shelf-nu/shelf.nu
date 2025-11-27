import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import {
  data,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { Form } from "~/components/custom-form";
import { ColorInput } from "~/components/forms/color-input";
import Input from "~/components/forms/input";

import { Button } from "~/components/shared/button";

import { createCategory } from "~/modules/category/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { getRandomColor } from "~/utils/get-random-color";
import { payload, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

const title = "New category";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.category,
      action: PermissionAction.create,
    });

    const header = {
      title,
    };

    return payload({ header, colorFromServer });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export async function action({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.category,
      action: PermissionAction.create,
    });

    const payload = parseData(await request.formData(), NewCategoryFormSchema, {
      additionalData: { userId, organizationId },
    });

    await createCategory({
      ...payload,
      userId: authSession.userId,
      organizationId,
    });

    sendNotification({
      title: "Category created",
      message: "Your category has been created successfully",
      icon: { name: "success", variant: "success" },
      senderId: authSession.userId,
    });

    if (payload.preventRedirect === "true") {
      return json(data({ success: true }));
    }

    return redirect("/categories");
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}

export default function NewCategory() {
  return <NewCategoryForm />;
}
