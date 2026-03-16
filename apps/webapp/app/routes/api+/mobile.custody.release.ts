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
 * POST /api/mobile/custody/release
 *
 * Releases custody of an asset (checks it back in).
 * Body: { assetId: string }
 */
export async function action({ request }: ActionFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    const body = await request.json();
    const { assetId } = z
      .object({
        assetId: z.string().min(1),
      })
      .parse(body);

    // Verify asset exists, belongs to org, and has custody
    const asset = await db.asset.findUnique({
      where: { id: assetId, organizationId },
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

    if (!asset) {
      return data({ error: { message: "Asset not found" } }, { status: 404 });
    }

    if (!asset.custody) {
      return data(
        { error: { message: "Asset does not have custody assigned" } },
        { status: 400 }
      );
    }

    const { custodian } = asset.custody;

    // Release custody: update status + delete custody record
    const updatedAsset = await db.asset.update({
      where: { id: assetId, organizationId },
      data: {
        status: AssetStatus.AVAILABLE,
        custody: {
          delete: true,
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
      content: `${actor} released ${custodianDisplay}'s custody via mobile app.`,
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
