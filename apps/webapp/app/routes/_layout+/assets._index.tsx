import type {
  ActionFunctionArgs,
  LinksFunction,
  LoaderFunctionArgs,
  MetaFunction,
  ShouldRevalidateFunctionArgs,
} from "react-router";
import { data, useLoaderData } from "react-router";
import { z } from "zod";
import { ArchivedViewMenu } from "~/components/assets/archived-view-menu";
import { assetsEmptyStateContent } from "~/components/assets/assets-index/assets-empty-state";
import { AssetsList } from "~/components/assets/assets-index/assets-list";
import { BulkDeleteAssetsSchema } from "~/components/assets/bulk-delete-dialog";
import { ImportButton } from "~/components/assets/import-button";
import { NewAssetDropdown } from "~/components/assets/new-asset-dropdown";
import Header from "~/components/layout/header";
import When from "~/components/when/when";
import { db } from "~/database/db.server";

import { useSearchParams } from "~/hooks/search-params";
import { useAssetIndexViewState } from "~/hooks/use-asset-index-view-state";
import { useCanViewArchivedAssets } from "~/hooks/use-can-view-archived-assets";
import { useOrganizationRoles } from "~/hooks/use-organization-roles";
import {
  advancedModeLoader,
  simpleModeLoader,
} from "~/modules/asset/data.server";
import { lastAuditDateAccessFor } from "~/modules/asset/last-audit-date-access.server";
import { bulkDeleteAssets } from "~/modules/asset/service.server";
import { CurrentSearchParamsSchema } from "~/modules/asset/utils.server";
import {
  CreatePresetFormSchema,
  RenamePresetFormSchema,
  DeletePresetFormSchema,
} from "~/modules/asset-filter-presets/schemas";
import {
  createPreset,
  deletePreset,
  togglePresetStar,
  listPresetsForUser,
  renamePreset,
} from "~/modules/asset-filter-presets/service.server";
import {
  changeMode,
  getAssetIndexSettings,
} from "~/modules/asset-index-settings/service.server";
import assetCss from "~/styles/assets.css?url";
import calendarStyles from "~/styles/layout/calendar.css?url";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { checkExhaustiveSwitch } from "~/utils/check-exhaustive-switch";
import { getClientHint } from "~/utils/client-hints";
import { resolveUserFormatPrefsById } from "~/utils/date-format.server";

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
        access,
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
            displayName: true,
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
      role,
    });
    const mode = settings.mode;

    /** The advanced index is a per-role capability; switch back if the role lacks it. */
    if (mode === "ADVANCED" && !access.policy.ui.advancedAssetIndex) {
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
        shouldBeCaptured: false,
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
          canSeeAllCustody: access.custody.seeAll,
          access,
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
          canSeeAllCustody: access.custody.seeAll,
          access,
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

    const IntentSchema = z.enum([
      "bulk-delete",
      "create-preset",
      "rename-preset",
      "delete-preset",
      "toggle-star-preset",
    ]);

    const { intent } = parseData(formData, z.object({ intent: IntentSchema }));

    const intent2ActionMap: Record<
      z.infer<typeof IntentSchema>,
      PermissionAction
    > = {
      "bulk-delete": PermissionAction.delete,
      "create-preset": PermissionAction.read,
      "rename-preset": PermissionAction.read,
      "delete-preset": PermissionAction.read,
      "toggle-star-preset": PermissionAction.read,
    };

    const {
      organizationId,
      canUseBarcodes,
      role,
      access,
      currentOrganization,
    } = await requirePermission({
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
      role,
    });

    switch (intent) {
      case "bulk-delete": {
        const { assetIds, confirmation, currentSearchParams } = parseData(
          formData,
          BulkDeleteAssetsSchema.and(CurrentSearchParamsSchema)
        );

        // Acting user's timezone: when "select all" is active the deletion set
        // is resolved from the current date filters, which must truncate the
        // day in the user's tz (avoids an off-by-one for non-UTC users).
        const { timeZone } = await resolveUserFormatPrefsById(
          userId,
          getClientHint(request)
        );

        await bulkDeleteAssets({
          assetIds,
          organizationId,
          userId,
          currentSearchParams,
          settings,
          lastAuditDateAccess: lastAuditDateAccessFor(
            access,
            currentOrganization
          ),
          confirmation,
          timeZone,
        });

        sendNotification({
          title: "Assets deleted",
          message: "Your assets has been deleted successfully",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return payload({ success: true });
      }

      case "create-preset": {
        const { name, query } = parseData(formData, CreatePresetFormSchema);

        await createPreset({
          organizationId,
          ownerId: userId,
          name,
          query,
        });

        const savedFilterPresets = await listPresetsForUser({
          organizationId,
          ownerId: userId,
        });

        return payload({ savedFilterPresets });
      }

      case "rename-preset": {
        const { presetId, name } = parseData(formData, RenamePresetFormSchema);

        await renamePreset({
          id: presetId,
          organizationId,
          ownerId: userId,
          name,
        });

        const savedFilterPresets = await listPresetsForUser({
          organizationId,
          ownerId: userId,
        });

        return payload({ savedFilterPresets });
      }

      case "delete-preset": {
        const { presetId } = parseData(formData, DeletePresetFormSchema);

        await deletePreset({
          id: presetId,
          organizationId,
          ownerId: userId,
        });

        const savedFilterPresets = await listPresetsForUser({
          organizationId,
          ownerId: userId,
        });

        return payload({ savedFilterPresets });
      }

      case "toggle-star-preset": {
        const { presetId, starred } = parseData(
          formData,
          z.object({
            presetId: z.string().min(1),
            starred: z.string().transform((val) => val === "true"),
          })
        );

        await togglePresetStar({
          id: presetId,
          starred,
          organizationId,
          ownerId: userId,
        });

        const savedFilterPresets = await listPresetsForUser({
          organizationId,
          ownerId: userId,
        });

        return payload({ savedFilterPresets });
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

/** The asset index's empty-state content for the current view. */
function useAssetsEmptyState(canImportAssets: boolean) {
  const [searchParams] = useSearchParams();
  return assetsEmptyStateContent({
    archivedView: searchParams.get("archived"),
    canImportAssets,
  });
}

export default function AssetIndexPage() {
  const roles = useOrganizationRoles();
  const { canImportAssets } = useLoaderData<typeof loader>();
  const { modeIsAdvanced } = useAssetIndexViewState();
  const emptyStateContent = useAssetsEmptyState(canImportAssets);
  const canViewArchivedAssets = useCanViewArchivedAssets();

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
            <NewAssetDropdown canImportAssets={canImportAssets} />
          </>
        </When>
      </Header>
      <AssetsList
        customEmptyStateContent={emptyStateContent}
        titleContent={
          canViewArchivedAssets ? (
            <ArchivedViewMenu plural="assets" />
          ) : undefined
        }
      />
    </div>
  );
}
