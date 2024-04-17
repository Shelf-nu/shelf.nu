import { useCallback } from "react";
import type { Custody, Template } from "@prisma/client";
import { AssetStatus, Roles } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useSearchParams } from "@remix-run/react";
import resolveConfig from "tailwindcss/resolveConfig";
import { Button } from "~/components/shared/button";
import Agreement from "~/components/sign/agreement";
import AgreementPopup, {
  AGREEMENT_POPUP_VISIBLE,
} from "~/components/sign/agreement-popup";

import { db } from "~/database/db.server";
import { createNote, getAsset } from "~/modules/asset/service.server";
import {
  initializePerPageCookieOnLayout,
  setCookie,
  userPrefs,
} from "~/utils/cookies.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ENABLE_PREMIUM_FEATURES } from "~/utils/env";
import { makeShelfError, ShelfError } from "~/utils/error";
import { error } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.validator.server";
import { requirePermission } from "~/utils/roles.server";
import tailwindConfig from "../../../tailwind.config";

export const loader = async ({ context, request }: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    // @TODO - this is not correct and should not be needed to be handled like this. The middleware will take care of this as long as its a private route
    const user = authSession
      ? await db.user.findUnique({
          where: { email: authSession.email.toLowerCase() },
          include: {
            roles: true,
            organizations: {
              select: {
                id: true,
                name: true,
                type: true,
                imageId: true,
              },
            },
          },
        })
      : undefined;

    // @TODO - this is not needed
    if (!user) {
      return redirect("/login");
    }

    if (!user?.onboarded) {
      return redirect("onboarding");
    }

    const cookie = await initializePerPageCookieOnLayout(request);

    // @TODO - this is the right way to handle searchParams
    const assigneeId = new URL(request.url).searchParams.get("assigneeId");
    const assetId = new URL(request.url).searchParams.get("assetId");
    // const templateId = params.templateId;
    const userId = user?.id;

    const { organizationId } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.template,
      action: PermissionAction.read,
    });

    // @TODO - See comment above
    if (!assetId || !assigneeId) {
      throw new ShelfError({
        cause: null,
        message: "Malformed URL",
        additionalData: { userId, assetId, assigneeId },
        label: "Assets",
        status: 400,
      });
    }

    if (userId !== assigneeId) {
      throw new ShelfError({
        cause: null,
        message: "You are not authorized to sign this asset",
        additionalData: { userId, assetId, assigneeId },
        label: "Assets",
        status: 401,
      });
    }

    const asset = await getAsset({
      id: assetId,
      organizationId,
    });

    // @TODO - this is not correct and is already handled inside getAsset
    if (!asset) {
      throw new ShelfError({
        cause: null,
        message: "Asset not found",
        status: 404,
        label: "Assets",
      });
    }

    // @TODO needs fixing -
    // @ts-ignore
    const custody = asset.custody as Custody;

    if (!custody) {
      throw new ShelfError({
        cause: null,
        message: "Custody record not found",
        status: 404,
        label: "Custody",
      });
    }

    // @ts-ignore
    const template = custody.template as Template;

    if (!template) {
      throw new ShelfError({
        cause: null,
        message: "Template not found",
        status: 404,
        label: "Template",
      });
    }

    return json(
      {
        user,
        currentOrganizationId: organizationId,
        enablePremium: ENABLE_PREMIUM_FEATURES,
        custody,
        template,
        isAdmin: user?.roles.some((role) => role.name === Roles["ADMIN"]),
      },
      {
        headers: [setCookie(await userPrefs.serialize(cookie))],
      }
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
};

export async function action({ context, request }: ActionFunctionArgs) {
  // @TODO - this needs to be handled in the new way
  // assertIsPost(request);
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const user = await db.user
      // @TODO - needs to use findUniqueOrThrow
      .findUnique({
        where: {
          id: userId,
        },
        select: {
          firstName: true,
          lastName: true,
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message: "Error while fetching user",
          status: 500,
          label: "User",
        });
      });

    // @TODO - see above
    if (!user)
      throw new ShelfError({
        cause: null,
        message: "User not found",
        status: 404,
        label: "User",
      });

    // @TODO - needs to be handled in the new way
    const assetId = new URL(request.url).searchParams.get("assetId");
    if (!assetId) {
      throw new ShelfError({
        cause: null,
        message: "Asset not found",
        status: 400,
        label: "Assets",
      });
    }

    // @TODO - needs to be handled in the new way
    const formData = await request.clone().formData();
    const signatureText = formData.get("signatureText") as string;
    const signatureImage = formData.get("signatureImage") as string;

    if (!signatureText && !signatureImage) {
      throw new ShelfError({
        cause: null,
        message: "Signature is required",
        status: 400,
        label: "Template",
      });
    }

    // Update the custody record
    // @TODO - needs to be caught
    await db.custody.update({
      where: {
        assetId,
      },
      data: {
        signatureImage,
        signatureText,
        templateSigned: true,
      },
    });

    // Update the asset status
    // @TODO - needs to be caught
    await db.asset.update({
      where: {
        id: assetId,
      },
      data: {
        status: AssetStatus.IN_CUSTODY,
      },
    });

    // Send out the notification
    sendNotification({
      title: "Asset signed",
      message: "Your asset has been signed successfully",
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    // Create a note
    await createNote({
      content: `${user.firstName} ${user.lastName} signed the asset and now has custody of it`,
      type: "UPDATE",
      userId: userId,
      assetId: assetId,
    });

    return redirect(`/assets/${assetId}`);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
}

export default function Sign() {
  const { template } = useLoaderData<typeof loader>();
  const twConfig = resolveConfig(tailwindConfig);
  const [params, setParams] = useSearchParams();
  const showAgreementPopup = useCallback(() => {
    params.set(AGREEMENT_POPUP_VISIBLE, "true");
    setParams(params);
  }, [params, setParams]);

  return (
    <div className="flex h-full flex-col md:flex-row">
      <AgreementPopup templateName={template.name} />
      <div className="order-2 grow md:order-1">PDF GOES HERE</div>
      <div className="order-1 flex max-h-[90vh] w-full flex-col overflow-y-auto overflow-x-clip border-l-DEFAULT border-l-gray-200 md:order-2 md:w-[400px]">
        <div className="flex w-full items-center justify-between gap-x-2 border-b-DEFAULT border-b-gray-200 p-4">
          <div title="Home" className="block h-[32px]">
            <img
              src="/images/logo-full-color(x2).png"
              alt="logo"
              className="h-full"
            />
          </div>
          <Button
            onClick={showAgreementPopup}
            className="block md:hidden"
            variant="primary"
          >
            Sign
          </Button>
        </div>
        <div className="flex flex-col gap-y-2 border-b-DEFAULT border-b-gray-200 p-4">
          <h1 className="text-lg font-semibold text-gray-800">
            {template.name}
          </h1>
          <p className="text-gray-600">
            {template.description ?? "No description provided"}
          </p>
        </div>
        {/* @ts-ignore */}
        {window.innerWidth > twConfig.theme.screens.md.split("px")[0] && (
          <Agreement />
        )}
      </div>
    </div>
  );
}
