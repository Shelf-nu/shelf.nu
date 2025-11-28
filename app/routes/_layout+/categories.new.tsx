import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, redirect } from "react-router";
import NewCategoryForm, {
  NewCategoryFormSchema,
} from "~/components/category/new-category-form";

import { createCategory } from "~/modules/category/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
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

    return payload({ header });
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

    const parsedData = parseData(
      await request.formData(),
      NewCategoryFormSchema,
      {
        additionalData: { userId, organizationId },
      }
    );

    const category = await createCategory({
      ...parsedData,
      userId: authSession.userId,
      organizationId,
    });

    sendNotification({
      title: "Category created",
      message: "Your category has been created successfully",
      icon: { name: "success", variant: "success" },
      senderId: authSession.userId,
    });

    if (parsedData.preventRedirect === "true") {
      return data(payload({ success: true, category }));
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
