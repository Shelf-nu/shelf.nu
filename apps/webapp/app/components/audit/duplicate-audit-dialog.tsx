/**
 * Duplicate Audit Dialog
 *
 * Confirmation UI for duplicating an audit session. Renders inline
 * as child route content (not a modal overlay). Shows warnings when
 * some original assets no longer exist, and blocks duplication when
 * all assets are gone.
 *
 * @see {@link file://./../../routes/_layout+/audits.$auditId.duplicate.tsx}
 */
import { Form, useActionData, useLoaderData } from "react-router";
import { useDisabled } from "~/hooks/use-disabled";
import type { loader } from "~/routes/_layout+/audits.$auditId.duplicate";
import { Button } from "../shared/button";

/**
 * Renders the duplicate audit confirmation view with asset availability
 * warnings. Used as the default export of the duplicate route.
 */
export function DuplicateAuditDialog() {
  const { audit, originalAssetCount, availableAssetCount, droppedAssetCount } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<{ error?: { message: string } }>();
  const disabled = useDisabled();

  const allAssetsGone = availableAssetCount === 0;

  return (
    <div className="mt-4">
      <h3 className="mb-2 text-lg font-semibold">
        Duplicate Audit: {audit.name}
      </h3>

      <div className="mb-4 text-sm text-gray-500">
        <p className="mb-2">
          You&apos;re about to duplicate the audit{" "}
          <strong className="text-gray-900">{audit.name}</strong>.
        </p>
        <p>
          A new audit will be created with the same name, description, and
          assets. Assignments, notes, scans, and due date will not be copied.
        </p>
      </div>

      {/* Warning when some assets are missing */}
      {droppedAssetCount > 0 && !allAssetsGone && (
        <div className="mb-4 rounded-md border border-yellow-300 bg-yellow-50 p-4">
          <p className="text-sm text-yellow-800">
            {droppedAssetCount} of {originalAssetCount} assets from the original
            audit no longer exist and will not be included.
          </p>
        </div>
      )}

      {/* Error when ALL assets are gone */}
      {allAssetsGone && (
        <div className="mb-4 rounded-md border border-red-300 bg-red-50 p-4">
          <p className="text-sm text-red-700">
            None of the original assets exist anymore. Cannot duplicate this
            audit.
          </p>
        </div>
      )}

      {/* Server-side action errors */}
      {actionData?.error && (
        <div className="mb-4 rounded-md bg-red-50 p-4">
          <p className="text-sm text-red-500">{actionData.error.message}</p>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          className="flex-1"
          disabled={disabled}
          to=".."
        >
          Cancel
        </Button>

        <Form method="POST" className="flex-1">
          <Button
            type="submit"
            className="w-full"
            disabled={disabled || allAssetsGone}
          >
            {disabled ? "Duplicating..." : "Confirm"}
          </Button>
        </Form>
      </div>
    </div>
  );
}
