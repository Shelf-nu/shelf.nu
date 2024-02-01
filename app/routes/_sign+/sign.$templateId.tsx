import { useCallback } from "react";
import type { Custody, Template } from "@prisma/client";
import { AssetStatus, Roles } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useSearchParams } from "@remix-run/react";
import resolveConfig from "tailwindcss/resolveConfig";
import { Button } from "~/components/shared";
import Agreement from "~/components/sign/agreement";
import AgreementPopup, {
  AGREEMENT_POPUP_VISIBLE,
} from "~/components/sign/agreement-popup";
import { db } from "~/database";
import { createNote, getAsset } from "~/modules/asset";
import { commitAuthSession, requireAuthSession } from "~/modules/auth";
import { ENABLE_PREMIUM_FEATURES, assertIsPost } from "~/utils";
import {
  initializePerPageCookieOnLayout,
  setCookie,
  userPrefs,
} from "~/utils/cookies.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfStackError } from "~/utils/error";
import { PermissionAction, PermissionEntity } from "~/utils/permissions";
import { requirePermision } from "~/utils/roles.server";
import tailwindConfig from "../../../tailwind.config";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // const authSession = await requireAuthSession(request);
  const { authSession, organizationId } = await requirePermision(
    request,
    PermissionEntity.asset,
    PermissionAction.read
  );
  // @TODO - we need to look into doing a select as we dont want to expose all data always
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
          userOrganizations: {
            where: {
              userId: authSession.userId,
            },
            select: {
              organization: true,
            },
          },
        },
      })
    : undefined;

  if (!user) {
    return redirect("/login");
  }

  if (!user?.onboarded) {
    return redirect("onboarding");
  }

  const cookie = await initializePerPageCookieOnLayout(request);

  const assigneeId = new URL(request.url).searchParams.get("assigneeId");
  const assetId = new URL(request.url).searchParams.get("assetId");
  // const templateId = params.templateId;
  const userId = user?.id;

  if (!assetId || !assigneeId) {
    throw new ShelfStackError({
      message: "Malformed URL",
      status: 400,
      title: "Malformed URL",
    });
  }

  if (userId !== assigneeId) {
    throw new ShelfStackError({
      message: "Unauthorized",
      status: 401,
      title: "Unauthorized",
    });
  }

  const asset = await getAsset({
    id: assetId,
    organizationId,
  });

  if (!asset) {
    throw new ShelfStackError({
      message: "Asset not found",
      status: 404,
      title: "Asset not found",
    });
  }

  // @TODO needs fixing -
  // @ts-ignore
  const custody = asset.custody as Custody;

  if (!custody) {
    throw new ShelfStackError({
      message: "Custody not found",
      status: 404,
      title: "Custody not found",
    });
  }

  // @ts-ignore
  const template = custody.template as Template;

  if (!template) {
    throw new ShelfStackError({
      message: "Template not found",
      status: 404,
      title: "Template not found",
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
      headers: [
        setCookie(await userPrefs.serialize(cookie)),
        setCookie(
          await commitAuthSession(request, {
            authSession,
          })
        ),
      ],
    }
  );
};

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const authSession = await requireAuthSession(request);
  const userId = authSession.userId;

  const user = await db.user.findUnique({
    where: {
      id: userId,
    },
    select: {
      firstName: true,
      lastName: true,
    },
  });

  if (!user) throw new ShelfStackError({ message: "User not found" });

  const assetId = new URL(request.url).searchParams.get("assetId");
  if (!assetId) {
    throw new ShelfStackError({
      message: "Malformed URL",
      status: 400,
      title: "Malformed URL",
    });
  }

  const formData = await request.clone().formData();
  const signatureText = formData.get("signatureText") as string;
  const signatureImage = formData.get("signatureImage") as string;

  if (!signatureText && !signatureImage) {
    throw new ShelfStackError({
      message: "Signature required",
      status: 400,
      title: "Signature required",
    });
  }

  // Update the custody record
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

  return redirect(`/assets/${assetId}`, {
    headers: {
      "Set-Cookie": await commitAuthSession(request, { authSession }),
    },
  });
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
      <div className="order-1 flex max-h-[90vh] w-full flex-col overflow-y-auto overflow-x-clip border-l-[1px] border-l-gray-200 md:order-2 md:w-[400px]">
        <div className="flex w-full items-center justify-between gap-x-2 border-b-[1px] border-b-gray-200 p-4">
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
        <div className="flex flex-col gap-y-2 border-b-[1px] border-b-gray-200 p-4">
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
