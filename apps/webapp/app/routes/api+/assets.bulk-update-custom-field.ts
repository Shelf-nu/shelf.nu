/**
 * Bulk "Set custom field".
 *
 * GET lists the custom fields the dialog can offer. POST sets one field to one
 * value on the selected assets, either only where the field is empty or on
 * every asset. Mirrors the other bulk-update endpoints: `asset: update`
 * permission, and "select all" resolved from the live search params.
 *
 * @see {@link file://../../components/assets/bulk-custom-field-update-dialog.tsx}
 * @see {@link file://../../modules/asset/bulk-custom-field.server.ts}
 */
import {
  data,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { BulkCustomFieldUpdateSchema } from "~/components/assets/bulk-custom-field-update-dialog";
import {
  bulkCustomFieldMessage,
  bulkSetAssetCustomField,
  getBulkSettableCustomFields,
} from "~/modules/asset/bulk-custom-field.server";
import { lastAuditDateAccessFor } from "~/modules/asset/last-audit-date-access.server";
import { resolveBookableListScope } from "~/modules/asset/list-scope.server";
import { CurrentSearchParamsSchema } from "~/modules/asset/utils.server";
import { getAssetIndexSettings } from "~/modules/asset-index-settings/service.server";
import { getClientHint } from "~/utils/client-hints";
import { resolveUserFormatPrefsById } from "~/utils/date-format.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { assertIsPost, error, parseData, payload } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

/**
 * The custom fields the bulk dialog can set.
 *
 * @returns `{ customFields }`, active and not deleted, in creation order
 */
export async function loader({ context, request }: LoaderFunctionArgs) {
  const { userId } = context.getSession();

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.update,
    });

    const customFields = await getBulkSettableCustomFields({ organizationId });
    return payload({ customFields });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

/**
 * Sets the chosen custom field on the selected assets.
 *
 * Expects `assetIds` (or the select-all key plus `currentSearchParams`),
 * `customFieldId`, `value` and `mode` (`EMPTY_ONLY` or `REPLACE`).
 *
 * @returns `{ success: true }` and a notification stating what changed and
 *   what was left alone, or an error payload with the refusal's status
 */
export async function action({ context, request }: ActionFunctionArgs) {
  const { userId } = context.getSession();

  try {
    assertIsPost(request);

    const formData = await request.formData();

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
      action: PermissionAction.update,
    });

    // Needed to resolve "select all" in advanced mode.
    const settings = await getAssetIndexSettings({
      userId,
      organizationId,
      canUseBarcodes,
      role,
    });

    const { assetIds, customFieldId, value, mode, currentSearchParams } =
      parseData(
        formData,
        BulkCustomFieldUpdateSchema.and(CurrentSearchParamsSchema)
      );

    // With "select all" active the set comes from the current date filters,
    // which truncate the day in the user's timezone.
    const { timeZone } = await resolveUserFormatPrefsById(
      userId,
      getClientHint(request)
    );

    const result = await bulkSetAssetCustomField({
      userId,
      organizationId,
      assetIds,
      customFieldId,
      rawValue: value,
      mode,
      currentSearchParams,
      settings,
      lastAuditDateAccess: lastAuditDateAccessFor(access, currentOrganization),
      bookableScope: resolveBookableListScope({ access, userId }),
      timeZone,
    });

    sendNotification({
      title: result.changed > 0 ? "Custom field set" : "Nothing to change",
      message: bulkCustomFieldMessage(result),
      // Only a change earns the success tick; a no-op reads as information.
      icon:
        result.changed > 0
          ? { name: "success", variant: "success" }
          : { name: "custom-field", variant: "gray" },
      senderId: userId,
    });

    return payload({ success: true });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
