import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { Notes } from "~/components/assets/notes";
import { NoPermissionsIcon } from "~/components/icons/library";
import type { HeaderData } from "~/components/layout/header/types";
import TextualDivider from "~/components/shared/textual-divider";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { getAsset } from "~/modules/asset/service.server";
import { getPaginatedAndFilterableAssetNotes } from "~/modules/note/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { setCookie, userPrefs } from "~/utils/cookies.server";
import { makeShelfError } from "~/utils/error";
import { payload, error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { assetId: id } = getParams(params, z.object({ assetId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId, userOrganizations } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.read,
    });

    /**
     * Fetch the asset (which also enforces org/permission scoping) for the page
     * header and the "Export activity CSV" link, and the notes page in
     * parallel. Notes are fetched separately — and paginated/searched/filtered —
     * so the activity log behaves like every other list in the app. Both are
     * independently org-scoped, so they can run concurrently.
     */
    const [
      asset,
      {
        page,
        perPage,
        search,
        items,
        totalItems,
        totalPages,
        hasNotes,
        cookie,
      },
    ] = await Promise.all([
      getAsset({
        id,
        organizationId,
        userOrganizations,
        request,
      }),
      getPaginatedAndFilterableAssetNotes({
        assetId: id,
        organizationId,
        request,
      }),
    ]);

    const header: HeaderData = {
      title: `${asset.title}'s activity`,
    };

    const modelName = {
      singular: "note",
      plural: "notes",
    };

    return data(
      payload({
        asset,
        header,
        items,
        totalItems,
        page,
        perPage,
        search,
        totalPages,
        hasNotes,
        modelName,
        searchFieldLabel: "Search notes",
      }),
      {
        // Persist the per-page preference the service resolved for this request.
        headers: [setCookie(await userPrefs.serialize(cookie))],
      }
    );
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw data(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const handle = {
  breadcrumb: () => "Activity",
};

export default function AssetActivity() {
  const { roles } = useUserRoleHelper();
  const canReadNotes = userHasPermission({
    roles,
    entity: PermissionEntity.note,
    action: PermissionAction.read,
  });

  return (
    <div className="w-full">
      {canReadNotes ? (
        <>
          <TextualDivider text="Notes" className="mb-8 lg:hidden" />
          <Notes />
        </>
      ) : (
        <div className="flex h-full flex-col justify-center">
          <div className="flex flex-col items-center justify-center  text-center">
            <div className="mb-4 inline-flex size-8 items-center justify-center  rounded-full bg-primary-100 p-2 text-primary-600">
              <NoPermissionsIcon />
            </div>
            <h5>Insufficient permissions</h5>
            <p>You are not allowed to view asset notes</p>
          </div>
        </div>
      )}
    </div>
  );
}
