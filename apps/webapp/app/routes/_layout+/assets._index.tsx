import type {
  ActionFunctionArgs,
  LinksFunction,
  LoaderFunctionArgs,
  MetaFunction,
  ShouldRevalidateFunctionArgs,
} from "react-router";
import { data, useLoaderData } from "react-router";
import { z } from "zod";
import { AssetsList } from "~/components/assets/assets-index/assets-list";
import { ImportButton } from "~/components/assets/import-button";
import { NewAssetDropdown } from "~/components/assets/new-asset-dropdown";
import Header from "~/components/layout/header";
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
  CreatePresetFormSchema,
  RenamePresetFormSchema,
  DeletePresetFormSchema,
  SharePresetFormSchema,
} from "~/modules/asset-filter-presets/schemas";
import {
  createPreset,
  deletePreset,
  togglePresetStar,
  listPresetsWithShared,
  renamePreset,
  setPresetShared,
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
import { hasPermission } from "~/utils/permissions/permission.validator.server";
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
        canSeeAllCustody,
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
          canSeeAllCustody,
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
          canSeeAllCustody,
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
      "share-preset",
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
      // Publishing a view to the workspace is an index-settings change, not an
      // asset read — it is what separates who may share from who may save.
      "share-preset": PermissionAction.update,
    };

    const intent2EntityMap: Record<
      z.infer<typeof IntentSchema>,
      PermissionEntity
    > = {
      "bulk-delete": PermissionEntity.asset,
      "create-preset": PermissionEntity.asset,
      "rename-preset": PermissionEntity.asset,
      "delete-preset": PermissionEntity.asset,
      "toggle-star-preset": PermissionEntity.asset,
      "share-preset": PermissionEntity.assetIndexSettings,
    };

    const { organizationId, canUseBarcodes, role } = await requirePermission({
      userId,
      request,
      entity: intent2EntityMap[intent],
      action: intent2ActionMap[intent],
    });

    /**
     * Whether the caller may manage the workspace's shared views — the same
     * permission that gates sharing. It lets them delete a preset someone else
     * shared, so an abandoned view can be retired; it never reaches another
     * person's private preset.
     */
    const canManageSharedPresets = await hasPermission({
      organizationId,
      userId,
      roles: role ? [role] : [],
      entity: PermissionEntity.assetIndexSettings,
      action: PermissionAction.update,
    });

    /** The saved-filters list every preset intent echoes back to the client. */
    const listSavedFilterPresets = () =>
      listPresetsWithShared({ organizationId, ownerId: userId });

    // Fetch asset index settings to determine mode
    const settings = await getAssetIndexSettings({
      userId,
      organizationId,
      canUseBarcodes,
      role,
    });

    switch (intent) {
      case "bulk-delete": {
        const { assetIds, currentSearchParams } = parseData(
          formData,
          z
            .object({ assetIds: z.array(z.string()).min(1) })
            .and(CurrentSearchParamsSchema)
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

        return payload({ savedFilterPresets: await listSavedFilterPresets() });
      }

      case "rename-preset": {
        const { presetId, name } = parseData(formData, RenamePresetFormSchema);

        await renamePreset({
          id: presetId,
          organizationId,
          ownerId: userId,
          name,
        });

        return payload({ savedFilterPresets: await listSavedFilterPresets() });
      }

      case "delete-preset": {
        const { presetId } = parseData(formData, DeletePresetFormSchema);

        await deletePreset({
          id: presetId,
          organizationId,
          ownerId: userId,
          canManageSharedPresets,
        });

        return payload({ savedFilterPresets: await listSavedFilterPresets() });
      }

      case "share-preset": {
        const { presetId, shared } = parseData(formData, SharePresetFormSchema);

        await setPresetShared({
          id: presetId,
          organizationId,
          ownerId: userId,
          shared,
        });

        sendNotification({
          title: shared ? "Filter shared" : "Filter unshared",
          message: shared
            ? "Everyone in this workspace can now use this saved filter."
            : "This saved filter is private again.",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return payload({ savedFilterPresets: await listSavedFilterPresets() });
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

        return payload({ savedFilterPresets: await listSavedFilterPresets() });
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
            <NewAssetDropdown canImportAssets={canImportAssets} />
          </>
        </When>
      </Header>
      <AssetsList
        customEmptyStateContent={{
          title: "No assets yet",
          text: "Assets are the core of your inventory. Create your first asset to start tracking equipment, devices, or anything your team manages.",
          newButtonRoute: "/assets/new",
          newButtonContent: "Create your first asset",
        }}
      />
    </div>
  );
}
