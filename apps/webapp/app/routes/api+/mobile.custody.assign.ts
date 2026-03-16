import { AssetStatus, type Prisma } from "@prisma/client";
import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { createNote } from "~/modules/note/service.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import {
  wrapUserLinkForNote,
  wrapCustodianForNote,
} from "~/utils/markdoc-wrappers";

/**
 * POST /api/mobile/custody/assign
 *
 * Assigns custody of an asset to a team member.
 * Body: { assetId: string, custodianId: string }
 */
export async function action({ request }: ActionFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    const body = await request.json();
    const { assetId, custodianId } = z
      .object({
        assetId: z.string().min(1),
        custodianId: z.string().min(1),
      })
      .parse(body);

    // Verify asset exists and belongs to the organization
    const asset = await db.asset.findUnique({
      where: { id: assetId, organizationId },
      select: {
        id: true,
        title: true,
        status: true,
        custody: { select: { id: true } },
      },
    });

    if (!asset) {
      return data({ error: { message: "Asset not found" } }, { status: 404 });
    }

    // Cannot assign custody if already in custody
    if (asset.custody) {
      return data(
        { error: { message: "Asset already has custody assigned" } },
        { status: 400 }
      );
    }

    // Verify the custodian (team member) exists in the same org
    const custodian = await db.teamMember.findFirst({
      where: {
        id: custodianId,
        organizationId,
        deletedAt: null,
      },
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

    // Assign custody: update status + create custody record
    const updatedAsset = await db.asset
      .update({
        where: { id: assetId, organizationId } as Prisma.AssetWhereUniqueInput,
        data: {
          status: AssetStatus.IN_CUSTODY,
          custody: {
            create: {
              custodian: { connect: { id: custodianId } },
            },
          },
        },
        select: {
          id: true,
          title: true,
          status: true,
          custody: {
            select: {
              custodian: { select: { id: true, name: true } },
            },
          },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message: "Failed to assign custody",
          additionalData: { assetId, custodianId },
          label: "Custody",
        });
      });

    // Create a note for the activity log (matches webapp format)
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

    await createNote({
      content: `${actor} assigned custody to ${custodianDisplay} via mobile app.`,
      type: "UPDATE",
      userId: user.id,
      assetId: asset.id,
    });

    return data({ asset: updatedAsset });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
