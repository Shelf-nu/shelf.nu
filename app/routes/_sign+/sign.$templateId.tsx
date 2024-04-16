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
import { ShelfError } from "~/utils/error";
import tailwindConfig from "../../../tailwind.config";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // @ts-expect-error @TODO - update to use new method
  const authSession = await requireAuthSession(request);
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
  // @ts-expect-error @TODO - update to use new method

  const { organizationId } = await requireOrganisationId(authSession, request);

  if (!assetId || !assigneeId) {
    // @ts-expect-error @TODO - update to use new method
    throw new ShelfError({
      message: "Malformed URL",
      status: 400,
      title: "Malformed URL",
    });
  }

  if (userId !== assigneeId) {
    // @ts-expect-error @TODO - update to use new method
    throw new ShelfError({
      message: "Unauthorized",
      status: 401,
      title: "Unauthorized",
    });
  }

  const asset = await getAsset({
    id: assetId,
    organizationId,
  });

  // @TODO needs fixing -
  // @ts-ignore
  const custody = asset.custody as Custody;

  if (!custody) {
    // @ts-expect-error @TODO - update to use new method
    throw new ShelfError({
      message: "Custody not found",
      status: 404,
      title: "Custody not found",
    });
  }

  // @ts-ignore
  const template = custody.template as Template;

  if (!template) {
    // @ts-expect-error @TODO - update to use new method
    throw new ShelfError({
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
          // @ts-expect-error @TODO - update to use new method
          await commitAuthSession(request, {
            authSession,
          })
        ),
      ],
    }
  );
};

export async function action({ request }: ActionFunctionArgs) {
  // @ts-expect-error @TODO - update to use new method
  assertIsPost(request);

  // @ts-expect-error @TODO - update to use new method
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

  // @ts-expect-error @TODO - update to use new method
  if (!user) throw new ShelfError({ message: "User not found" });

  const assetId = new URL(request.url).searchParams.get("assetId");
  if (!assetId) {
    // @ts-expect-error @TODO - update to use new method
    throw new ShelfError({
      message: "Malformed URL",
      status: 400,
      title: "Malformed URL",
    });
  }

  const formData = await request.clone().formData();
  const signatureText = formData.get("signatureText") as string;
  const signatureImage = formData.get("signatureImage") as string;

  if (!signatureText && !signatureImage) {
    // @ts-expect-error @TODO - update to use new method
    throw new ShelfError({
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
      // @ts-expect-error @TODO - update to use new method
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
