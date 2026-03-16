import { AssetStatus, type Prisma } from "@prisma/client";
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
 * POST /api/mobile/bulk-assign-custody
 *
 * Assigns custody of multiple assets to a team member.
 * Body: { assetIds: string[], custodianId: string }
 */
export async function action({ request }: ActionFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    const body = await request.json();
    const { assetIds, custodianId } = z
      .object({
        assetIds: z.array(z.string().min(1)).min(1),
        custodianId: z.string().min(1),
      })
      .parse(body);

    // Verify the custodian exists in the same org
    const custodian = await db.teamMember.findFirst({
      where: { id: custodianId, organizationId, deletedAt: null },
      select: {
        id: true,
        name: true,
        user: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });

    if (!custodian) {
      return data(
        { error: { message: "Team member not found" } },
        { status: 404 }
      );
    }

    // Fetch all assets and filter to only those that can be assigned
    const assets = await db.asset.findMany({
      where: { id: { in: assetIds }, organizationId },
      select: {
        id: true,
        title: true,
        status: true,
        custody: { select: { id: true } },
      },
    });

    // Only assign custody to assets that don't already have it
    const assignable = assets.filter((a) => !a.custody);

    if (assignable.length === 0) {
      return data(
        {
          error: {
            message: "No assets are available for custody assignment",
          },
        },
        { status: 400 }
      );
    }

    // Bulk update: set status + create custody for each asset
    await db.$transaction(
      assignable.map((asset) =>
        db.asset.update({
          where: {
            id: asset.id,
            organizationId,
          } as Prisma.AssetWhereUniqueInput,
          data: {
            status: AssetStatus.IN_CUSTODY,
            custody: {
              create: { custodian: { connect: { id: custodianId } } },
            },
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

    const custodianDisplay = wrapCustodianForNote({
      teamMember: {
        name: custodian.name,
        user: custodian.user
          ? {
              id: custodian.user.id,
              firstName: custodian.user.firstName,
              lastName: custodian.user.lastName,
            }
          : null,
      },
    });

    await Promise.all(
      assignable.map((asset) =>
        createNote({
          content: `${actor} assigned custody to ${custodianDisplay} via mobile app.`,
          type: "UPDATE",
          userId: user.id,
          assetId: asset.id,
        })
      )
    );

    return data({
      success: true,
      assigned: assignable.length,
      skipped: assets.length - assignable.length,
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
