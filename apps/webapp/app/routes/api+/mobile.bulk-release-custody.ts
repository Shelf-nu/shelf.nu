import { AssetStatus } from "@prisma/client";
import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { createNote } from "~/modules/note/service.server";
import { makeShelfError } from "~/utils/error";
import {
  wrapUserLinkForNote,
  wrapCustodianForNote,
} from "~/utils/markdoc-wrappers";

/**
 * POST /api/mobile/bulk-release-custody
 *
 * Releases custody of multiple assets (bulk check-in).
 * Body: { assetIds: string[] }
 */
export async function action({ request }: ActionFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    const body = await request.json();
    const { assetIds } = z
      .object({
        assetIds: z.array(z.string().min(1)).min(1),
      })
      .parse(body);

    // Fetch all assets with custody info
    const assets = await db.asset.findMany({
      where: { id: { in: assetIds }, organizationId },
      select: {
        id: true,
        title: true,
        status: true,
        custody: {
          select: {
            custodian: {
              select: {
                id: true,
                name: true,
                user: {
                  select: { id: true, firstName: true, lastName: true },
                },
              },
            },
          },
        },
      },
    });

    // Only release assets that actually have custody
    const releasable = assets.filter((a) => a.custody);

    if (releasable.length === 0) {
      return data(
        { error: { message: "No assets have custody to release" } },
        { status: 400 }
      );
    }

    // Bulk update: set status + delete custody for each asset
    await db.$transaction(
      releasable.map((asset) =>
        db.asset.update({
          where: { id: asset.id, organizationId },
          data: {
            status: AssetStatus.AVAILABLE,
            custody: { delete: true },
          },
        })
      )
    );

    // Create activity notes
    const actor = wrapUserLinkForNote({
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
    });

    await Promise.all(
      releasable.map((asset) => {
        const custodianDisplay = wrapCustodianForNote({
          teamMember: {
            name: asset.custody!.custodian.name,
            user: asset.custody!.custodian.user
              ? {
                  id: asset.custody!.custodian.user.id,
                  firstName: asset.custody!.custodian.user.firstName,
                  lastName: asset.custody!.custodian.user.lastName,
                }
              : null,
          },
        });

        return createNote({
          content: `${actor} released ${custodianDisplay}'s custody via mobile app.`,
          type: "UPDATE",
          userId: user.id,
          assetId: asset.id,
        });
      })
    );

    return data({
      success: true,
      released: releasable.length,
      skipped: assets.length - releasable.length,
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
