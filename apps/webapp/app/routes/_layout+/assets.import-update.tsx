/**
 * @file Route for bulk-updating existing assets via CSV import.
 * Handles two intents: `preview-update` (analyze CSV and return diffs)
 * and `apply-update` (apply confirmed changes to the database).
 *
 * @see {@link file://./../../components/assets/bulk-update/index.tsx} UI component
 * @see {@link file://./../../utils/import-update.server.ts} Server-side logic
 */
import type {
  ActionFunctionArgs,
  MetaFunction,
  LoaderFunctionArgs,
} from "react-router";
import { data, Link } from "react-router";
import { z } from "zod";
import { ImportUpdateContent } from "~/components/assets/bulk-update";
import Header from "~/components/layout/header";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { checkExhaustiveSwitch } from "~/utils/check-exhaustive-switch";
import { csvDataFromRequest } from "~/utils/csv.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import { payload, error, parseData } from "~/utils/http.server";
import {
  buildUpdatePreview,
  applyBulkUpdatesFromImport,
} from "~/utils/import-update.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { assertUserCanImportAssets } from "~/utils/subscription.server";

/** Handles preview-update and apply-update intents for bulk CSV import. */
export const action = async ({ context, request }: ActionFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId, organizations } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.import,
    });

    await assertUserCanImportAssets({ organizationId, organizations });

    // Clone the request so we can read formData here for intent/validation
    // while preserving the original body for csvDataFromRequest() below
    const clonedFormData = await request.clone().formData();
    const { intent } = parseData(
      clonedFormData,
      z.object({
        intent: z.enum(["preview-update", "apply-update"]),
      })
    );

    // Validate file presence before parsing
    const file = clonedFormData.get("file");
    if (!file || !(file instanceof File) || file.size === 0) {
      throw new ShelfError({
        cause: null,
        message: "Please select a CSV file to upload.",
        label: "Assets",
        shouldBeCaptured: false,
      });
    }

    const csvData = await csvDataFromRequest({ request });
    if (csvData.length === 0) {
      throw new ShelfError({
        cause: null,
        message: "CSV file is empty or contains only whitespace.",
        label: "Assets",
        shouldBeCaptured: false,
      });
    }
    if (csvData.length === 1) {
      throw new ShelfError({
        cause: null,
        message:
          "CSV contains a header row but no data rows. Add at least one asset row below the headers.",
        label: "Assets",
        shouldBeCaptured: false,
      });
    }

    switch (intent) {
      case "preview-update": {
        const preview = await buildUpdatePreview({
          csvData,
          organizationId,
        });
        return payload({ success: true, intent, preview });
      }

      case "apply-update": {
        const confirmation = clonedFormData.get("confirmation");
        if (confirmation !== "I AGREE") {
          throw new ShelfError({
            cause: null,
            message: 'You must type "I AGREE" to confirm the bulk update.',
            label: "Assets",
            shouldBeCaptured: false,
          });
        }
        const result = await applyBulkUpdatesFromImport({
          csvData,
          organizationId,
          userId,
          request,
        });
        return payload({ success: true, intent, result });
      }

      default:
        checkExhaustiveSwitch(intent);
    }
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
};

export const loader = async ({ context, request }: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId, organizations } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.import,
    });

    await assertUserCanImportAssets({ organizationId, organizations });

    return payload({
      header: {
        title: "Update existing assets",
      },
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
};

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const handle = {
  breadcrumb: () => (
    <Link to="/assets/import-update">Update existing assets</Link>
  ),
};

export default function AssetsImportUpdate() {
  return (
    <div className="h-full">
      <Header />
      <div className="mx-auto h-auto w-full px-4 py-10">
        <ImportUpdateContent />
      </div>
    </div>
  );
}
