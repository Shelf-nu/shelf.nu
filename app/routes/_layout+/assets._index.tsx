import type {
  ActionFunctionArgs,
  LinksFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { data } from "@remix-run/node";
import type { ShouldRevalidateFunctionArgs } from "@remix-run/react";
import { useLoaderData } from "@remix-run/react";
import { z } from "zod";
import { AssetsList } from "~/components/assets/assets-index/assets-list";
import { ImportButton } from "~/components/assets/import-button";
import Header from "~/components/layout/header";
import { Button } from "~/components/shared/button";
import When from "~/components/when/when";
import { db } from "~/database/db.server";

import { useAssetIndexViewState } from "~/hooks/use-asset-index-view-state";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import {
  advancedModeLoader,
  simpleModeLoader,
} from "~/modules/asset/data.server";
import { bulkDeleteAssets } from "~/modules/asset/service.server";
import { CurrentSearchParamsSchema } from "~/modules/asset/utils.server";
import {
  changeMode,
  getAssetIndexSettings,
} from "~/modules/asset-index-settings/service.server";
import assetCss from "~/styles/assets.css?url";
import calendarStyles from "~/styles/layout/calendar.css?url";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { checkExhaustiveSwitch } from "~/utils/check-exhaustive-switch";

import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import { payload, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { requirePermission } from "~/utils/roles.server";

export type AssetIndexLoaderData = typeof loader;

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: assetCss },
  { rel: "stylesheet", href: calendarStyles },
];

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  try {
    /** Validate permissions and fetch user */
    const [
      {
        organizationId,
        organizations,
        currentOrganization,
        role,
        canUseBarcodes,
      },
      user,
    ] = await Promise.all([
      requirePermission({
        userId,
        request,
        entity: PermissionEntity.asset,
        action: PermissionAction.read,
      }),
      db.user
        .findUniqueOrThrow({
          where: {
            id: userId,
          },
          select: {
            firstName: true,
          },
        })
        .catch((cause) => {
          throw new ShelfError({
            cause,
            message:
              "We can't find your user data. Please try again or contact support.",
            additionalData: { userId },
            label: "Assets",
          });
        }),
    ]);

    const settings = await getAssetIndexSettings({
      userId,
      organizationId,
      canUseBarcodes,
    });
    const mode = settings.mode;

    /** For base and self service users, we dont allow to view the advanced index */
    if (mode === "ADVANCED" && ["BASE", "SELF_SERVICE"].includes(role)) {
      await changeMode({
        userId,
        organizationId,
        mode: "SIMPLE",
      });
      throw new ShelfError({
        cause: null,
        title: "Not allowed",
        message:
          "You don't have permission to access the advanced mode. We will automatically switch you back to 'simple' mode. Please reload the page.",
        label: "Assets",
        status: 403,
      });
    }

    return mode === "SIMPLE"
      ? await simpleModeLoader({
          request,
          userId,
          organizationId,
          organizations,
          role,
          currentOrganization,
          user,
          settings,
        })
      : await advancedModeLoader({
          request,
          userId,
          organizationId,
          organizations,
          role,
          currentOrganization,
          user,
          settings,
        });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const formData = await request.formData();

    const { intent } = parseData(
      formData,
      z.object({ intent: z.enum(["bulk-delete"]) })
    );

    const intent2ActionMap: { [K in typeof intent]: PermissionAction } = {
      "bulk-delete": PermissionAction.delete,
    };

    const { organizationId, canUseBarcodes } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: intent2ActionMap[intent],
    });

    // Fetch asset index settings to determine mode
    const settings = await getAssetIndexSettings({
      userId,
      organizationId,
      canUseBarcodes,
    });

    switch (intent) {
      case "bulk-delete": {
        const { assetIds, currentSearchParams } = parseData(
          formData,
          z
            .object({ assetIds: z.array(z.string()).min(1) })
            .and(CurrentSearchParamsSchema)
        );

        await bulkDeleteAssets({
          assetIds,
          organizationId,
          userId,
          currentSearchParams,
          settings,
        });

        sendNotification({
          title: "Assets deleted",
          message: "Your assets has been deleted successfully",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return payload({ success: true });
      }

      default: {
        checkExhaustiveSwitch(intent);
        return payload(null);
      }
    }
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}

export function shouldRevalidate({
  actionResult,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  /**
   * If we are toggling the sidebar, no need to revalidate this loader.
   * Revalidation happens in _layout
   */
  if (actionResult?.isTogglingSidebar) {
    return false;
  }

  return defaultShouldRevalidate;
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data?.header.title) },
];

export default function AssetIndexPage() {
  const { roles } = useUserRoleHelper();
  const { canImportAssets } = useLoaderData<typeof loader>();
  const { modeIsAdvanced } = useAssetIndexViewState();

  return (
    <div className="relative">
      <Header hidePageDescription={modeIsAdvanced}>
        <When
          truthy={userHasPermission({
            roles,
            entity: PermissionEntity.asset,
            action: PermissionAction.create,
          })}
        >
          <>
            <ImportButton canImportAssets={canImportAssets} />
            <Button
              to="new"
              role="link"
              aria-label={`new asset`}
              data-test-id="createNewAsset"
            >
              New asset
            </Button>
          </>
        </When>
      </Header>
      <AssetsList />
    </div>
  );
}
