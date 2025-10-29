import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, Outlet } from "@remix-run/react";
import { z } from "zod";
import { ErrorContent } from "~/components/errors";
import {
  softDeleteCustomField,
  getCustomField,
} from "~/modules/custom-field/service.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import { payload, error, parseData } from "~/utils/http.server";

import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.customField,
      action: PermissionAction.read,
    });

    return json(payload(null));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
}

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.customField,
      action: PermissionAction.delete,
    });

    const { id, confirmation } = parseData(
      await request.formData(),
      z.object({
        id: z.string(),
        confirmation: z
          .string()
          .min(1, "Confirmation is required")
          .transform((value) => value.trim()),
      }),
      { additionalData: { userId } }
    );

    const customField = await getCustomField({ id, organizationId });

    // Case-insensitive comparison
    if (customField.name.toLowerCase() !== confirmation.toLowerCase()) {
      throw new ShelfError({
        cause: null,
        message:
          "Confirmation text does not match the custom field name (case-insensitive).",
        additionalData: {
          userId,
          customFieldId: id,
          confirmation,
          expected: customField.name,
        },
        label: "Custom fields",
        status: 400,
        shouldBeCaptured: false,
      });
    }

    await softDeleteCustomField({ id, organizationId });

    sendNotification({
      title: "Custom field deleted",
      message: `The custom field "${customField.name}" has been deleted. You can now create a new field with the same name if needed.`,
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    return json(payload({ success: true }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}

export const handle = {
  breadcrumb: () => <Link to="/settings/custom-fields">Custom Fields</Link>,
};

// export const shouldRevalidate = () => false;

export default function CustomFieldsPage() {
  return <Outlet />;
}

export const ErrorBoundary = () => <ErrorContent />;
