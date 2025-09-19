import { Prisma } from "@prisma/client";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { z } from "zod";

import { db } from "~/database/db.server";
import { makeShelfError } from "~/utils/error";
import { data, error } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

const querySchema = z.object({
  q: z.string().trim().max(100).optional(),
});

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const url = new URL(request.url);
    const validated = querySchema.parse({
      q: url.searchParams.get("q") ?? undefined,
    });
    const query = validated.q?.trim() ?? "";

    if (!query) {
      return json(data({ query, assets: [] }));
    }

    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.read,
    });

    const terms = query
      .split(/[\s,]+/)
      .map((term) => term.trim())
      .filter(Boolean)
      .slice(0, 5);

    const searchTerms = terms.length > 0 ? terms : [query];

    const searchConditions: Prisma.AssetWhereInput[] = searchTerms.map(
      (term) => ({
        OR: [
          {
            title: { contains: term, mode: Prisma.QueryMode.insensitive },
          },
          {
            sequentialId: {
              contains: term,
              mode: Prisma.QueryMode.insensitive,
            },
          },
          {
            id: { contains: term, mode: Prisma.QueryMode.insensitive },
          },
          {
            description: {
              contains: term,
              mode: Prisma.QueryMode.insensitive,
            },
          },
          {
            location: {
              name: { contains: term, mode: Prisma.QueryMode.insensitive },
            },
          },
          {
            qrCodes: {
              some: {
                id: { contains: term, mode: Prisma.QueryMode.insensitive },
              },
            },
          },
          {
            barcodes: {
              some: {
                value: { contains: term, mode: Prisma.QueryMode.insensitive },
              },
            },
          },
          {
            customFields: {
              some: {
                value: {
                  path: ["valueText"],
                  string_contains: term,
                  mode: Prisma.QueryMode.insensitive,
                },
              },
            },
          },
        ],
      })
    );

    const where: Prisma.AssetWhereInput = {
      organizationId,
      ...(searchConditions.length ? { OR: searchConditions } : {}),
    };

    const assets = await db.asset.findMany({
      where,
      take: 25,
      orderBy: [{ updatedAt: "desc" }, { title: "asc" }],
      include: {
        location: { select: { name: true } },
      },
    });

    return json(
      data({
        query,
        assets: assets.map((asset) => ({
          id: asset.id,
          title: asset.title,
          sequentialId: asset.sequentialId,
          mainImage: asset.mainImage,
          mainImageExpiration: asset.mainImageExpiration?.toISOString() ?? null,
          locationName: asset.location?.name ?? null,
        })),
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}
