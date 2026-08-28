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
    /**
     * Two-step gate, in this order deliberately.
     *
     * Step 1 is `asset:read` against the SELECTED workspace, which is what
     * `getAsset` needs to run its cross-workspace resolution below. Gating on
     * `note:read` here instead would 403 a deep link to an asset that lives in
     * a DIFFERENT workspace of the same user — one where they may well hold
     * `note:read` — before `getAsset` ever gets the chance to offer the
     * switch-workspace path. Assets are unusual in having that affordance;
     * the bookings activity route has no equivalent, which is why it can gate
     * on `bookingNote:read` alone.
     */
    const { organizationId, userOrganizations } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.read,
    });

    /**
     * Resolve the asset FIRST. Besides supplying the page header and the
     * "Export activity CSV" link, this is the call that detects an asset
     * belonging to another of the user's workspaces and hands off to the
     * switch-workspace path. It must run before the note gate so that
     * hand-off still happens (see the ordering note above).
     */
    const asset = await getAsset({
      id,
      organizationId,
      userOrganizations,
      request,
    });

    /**
     * Step 2 of the gate: `note:read`, enforced BEFORE a single note is
     * fetched. This MUST stay server-side. `asset: [read]` is granted to BASE
     * and SELF_SERVICE while `note: []` is not, so gating only on `asset:read`
     * and hiding the notes in the component put every asset note in the page
     * payload of users not allowed to read them — visible to anyone who opens
     * devtools.
     *
     * The two steps are sequential rather than parallel by necessity: the
     * switch-workspace hand-off has to precede the gate, and the gate has to
     * precede the fetch.
     */
    await requirePermission({
      userId,
      request,
      entity: PermissionEntity.note,
      action: PermissionAction.read,
    });

    /**
     * Notes are fetched separately — and paginated/searched/filtered — so the
     * activity log behaves like every other list in the app.
     */
    const {
      page,
      perPage,
      search,
      items,
      totalItems,
      totalPages,
      hasNotes,
      cookie,
    } = await getPaginatedAndFilterableAssetNotes({
      assetId: id,
      organizationId,
      request,
    });

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
