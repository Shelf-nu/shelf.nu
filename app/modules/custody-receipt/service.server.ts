import type { Organization, Prisma } from "@prisma/client";
import { db } from "~/database/db.server";
import { updateCookieWithPerPage } from "~/utils/cookies.server";
import { isLikeShelfError, ShelfError } from "~/utils/error";
import { getCurrentSearchParams } from "~/utils/http.server";
import { getParamsValues } from "~/utils/list";

export async function getPaginatedAndFilterableReceipts({
  organizationId,
  request,
}: {
  organizationId: Organization["id"];
  request: Request;
}) {
  try {
    const searchParams = getCurrentSearchParams(request);
    const { page, perPageParam, search, signatureStatus, custodyStatus } =
      getParamsValues(searchParams);

    const cookie = await updateCookieWithPerPage(request, perPageParam);
    const { perPage } = cookie;

    const skip = page > 1 ? (page - 1) * perPage : 0;
    const take = perPage >= 1 && perPage <= 100 ? perPage : 20;

    const where: Prisma.CustodyReceiptWhereInput = { organizationId };

    if (search) {
      const searchTerm = search.toLowerCase().trim();

      // Search for the searchTerm in asset, agreement and custodian
      where.OR = [
        { asset: { title: { contains: searchTerm, mode: "insensitive" } } },
        { agreement: { name: { contains: searchTerm, mode: "insensitive" } } },
        {
          custodian: {
            OR: [
              { name: { contains: searchTerm, mode: "insensitive" } },
              {
                user: {
                  firstName: { contains: searchTerm, mode: "insensitive" },
                },
              },
              {
                user: {
                  lastName: { contains: searchTerm, mode: "insensitive" },
                },
              },
            ],
          },
        },
      ];
    }

    if (signatureStatus) {
      where.signatureStatus = signatureStatus;
    }

    if (custodyStatus) {
      where.custodyStatus = custodyStatus;
    }

    const [receipts, totalReceipts] = await Promise.all([
      db.custodyReceipt.findMany({
        where,
        take,
        skip,
        include: {
          asset: { select: { id: true, title: true } },
          custodian: {
            select: {
              id: true,
              name: true,
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                },
              },
            },
          },
          agreement: {
            select: {
              id: true,
              name: true,
              // This is only one file associated with an agreement.
              // User cannot update agreement file if there is a Custody with Agreement
              custodyAgreementFiles: {
                select: { url: true },
                take: 1,
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      db.custodyReceipt.count({ where }),
    ]);

    const totalPages = Math.ceil(totalReceipts / perPageParam);

    return {
      receipts,
      totalReceipts,
      page,
      perPage,
      totalPages,
      search,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      label: "Custody Receipt",
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while fetching custody receipts.",
    });
  }
}
