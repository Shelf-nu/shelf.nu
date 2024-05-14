import { json, redirect } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";

import { Form, useLoaderData, useNavigation } from "@remix-run/react";
import { z } from "zod";
import { UserXIcon } from "~/components/icons/library";
import { Button } from "~/components/shared/button";
import { getKit, releaseCustody } from "~/modules/kit/service.server";
import styles from "~/styles/layout/custom-modal.css?url";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { data, error, getParams, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.validator.server";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { kitId } = getParams(params, z.object({ kitId: z.string() }), {
    additionalData: { userId },
  });

  try {
    await requirePermission({
      userId,
      request,
      entity: PermissionEntity.kit,
      action: PermissionAction.update,
    });

    const kit = await getKit({ id: kitId });
    if (!kit.custody) {
      return redirect(`/kits/${kitId}`);
    }

    return json(
      data({
        showModal: true,
        kit,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, kitId });
    throw json(error(reason), { status: reason.status });
  }
}

export async function action({ context, request, params }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { kitId } = getParams(params, z.object({ kitId: z.string() }), {
    additionalData: { userId },
  });

  try {
    await requirePermission({
      userId,
      request,
      entity: PermissionEntity.kit,
      action: PermissionAction.update,
    });

    const kit = await releaseCustody({
      kitId,
      userId,
    });

    const { custodianName } = parseData(
      await request.formData(),
      z.object({
        custodianName: z.string(),
      }),
      {
        additionalData: { userId, kitId },
      }
    );

    sendNotification({
      title: `‘${kit.name}’ is no longer in custody of ‘${custodianName}’`,
      message: "This asset is available again.",
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    return redirect(`/kits/${kitId}`);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, kitId });
    return json(error(reason), { status: reason.status });
  }
}

export function links() {
  return [{ rel: "stylesheet", href: styles }];
}

export default function ReleaseKitCustody() {
  const { kit } = useLoaderData<typeof loader>();

  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);

  return (
    <>
      <div className="modal-content-wrapper">
        <div className="mb-4 inline-flex items-center justify-center rounded-full border-8 border-solid border-gray-50 bg-gray-100 p-2 text-gray-600">
          <UserXIcon />
        </div>
        <div className="mb-5">
          <h4>Releasing custody</h4>
          <p>
            Are you sure you want to release{" "}
            <span className="font-medium">{kit.custody?.custodian.name}’s</span>{" "}
            custody over <span className="font-medium">{kit.name}</span>?
          </p>
        </div>
        <div className="">
          <Form method="post" className="flex w-full gap-3">
            <input
              type="hidden"
              name="custodianName"
              value={kit.custody?.custodian.name}
            />
            <Button
              to=".."
              variant="secondary"
              width="full"
              disabled={disabled}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              width="full"
              type="submit"
              disabled={disabled}
            >
              Confirm
            </Button>
          </Form>
        </div>
      </div>
    </>
  );
}
