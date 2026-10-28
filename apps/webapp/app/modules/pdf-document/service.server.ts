/**
 * Printed Document Service
 *
 * Reads and writes a workspace's PDF documents: the named layouts of the
 * booking PDF. Every function takes the caller's `organizationId` and scopes
 * every query by it, so a document id from another workspace reads as not found.
 *
 * A workspace always has at least one document and exactly one default. New
 * workspaces get the built-in documents when they are created; a workspace that
 * has none (one created by a path that skips them) gets them the first time
 * its documents are read. Document names are unique per workspace, ignoring case.
 *
 * @see {@link file://./config.ts}
 * @see {@link file://../../routes/_layout+/settings.general.tsx}
 * @see {@link file://../../routes/api+/bookings.$bookingId.generate-pdf.tsx}
 */
import type { Prisma, PdfDocument } from "@prisma/client";
import { PdfDocumentKind } from "@prisma/client";
import type { ITXClientDenyList } from "@prisma/client/runtime/library";
import type { ExtendedPrismaClient } from "~/database/db.server";
import { db } from "~/database/db.server";
import { isLikeShelfError, ShelfError } from "~/utils/error";
import { assertCustomFieldsBelongToOrg } from "~/utils/org-validation.server";
import type { BookingDocumentConfig } from "./config";
import {
  BOOKING_CHECKLIST_CONFIG,
  builtInBookingDocuments,
  MAX_DOCUMENT_CUSTOM_FIELDS,
  MAX_DOCUMENT_NAME_LENGTH,
  parseBookingDocumentConfig,
} from "./config";

const label = "PDF documents";

type TxClient = Omit<ExtendedPrismaClient, ITXClientDenyList>;

const KIND = PdfDocumentKind.BOOKING;

/** A PDF document with its config parsed. */
export type ResolvedPdfDocument = Pick<
  PdfDocument,
  "id" | "name" | "isDefault"
> & { config: BookingDocumentConfig };

const DOCUMENT_SELECT = {
  id: true,
  name: true,
  isDefault: true,
  config: true,
} satisfies Prisma.PdfDocumentSelect;

/** List order: the default first, then the order the documents were made in. */
const DOCUMENT_ORDER = [
  { isDefault: "desc" },
  { createdAt: "asc" },
  { name: "asc" },
] satisfies Prisma.PdfDocumentOrderByWithRelationInput[];

function resolve(
  row: Prisma.PdfDocumentGetPayload<{ select: typeof DOCUMENT_SELECT }>
): ResolvedPdfDocument {
  return {
    id: row.id,
    name: row.name,
    isDefault: row.isDefault,
    config: parseBookingDocumentConfig(row.config),
  };
}

/**
 * The built-in documents as a nested create, for the paths that create a
 * workspace.
 *
 * @param params.canCustomize - Whether the owner's tier includes PDF
 *   documents, which adds the Check-out receipt
 * @returns The `pdfDocuments` value of an `OrganizationCreateInput`
 */
export function builtInPdfDocumentsCreate({
  canCustomize,
}: {
  canCustomize: boolean;
}) {
  return {
    createMany: {
      data: builtInBookingDocuments({ canCustomize }).map((document) => ({
        name: document.name,
        kind: KIND,
        config: document.config,
        isDefault: document.isDefault,
      })),
    },
  } satisfies Prisma.PdfDocumentCreateNestedManyWithoutOrganizationInput;
}

/**
 * Gives a workspace whose tier includes PDF documents the built-in ones.
 * Idempotent: two concurrent calls create each document once, because the
 * name and the default are both unique per workspace.
 */
async function seedDocuments(organizationId: string) {
  await db.pdfDocument.createMany({
    data: builtInBookingDocuments({ canCustomize: true }).map((document) => ({
      organizationId,
      name: document.name,
      kind: KIND,
      config: document.config,
      isDefault: document.isDefault,
    })),
    skipDuplicates: true,
  });
}

/**
 * Every booking document of a workspace, default first. Only for a workspace
 * whose tier includes PDF documents: one that has none yet gets the built-in
 * ones here.
 *
 * @param params.organizationId - The caller's workspace
 * @returns The documents with their configs parsed
 * @throws {ShelfError} 500 when the read fails
 */
export async function getPdfDocuments({
  organizationId,
}: {
  organizationId: string;
}): Promise<ResolvedPdfDocument[]> {
  try {
    const read = () =>
      db.pdfDocument.findMany({
        where: { organizationId, kind: KIND },
        select: DOCUMENT_SELECT,
        orderBy: DOCUMENT_ORDER,
      });
    let rows = await read();
    if (rows.length === 0) {
      await seedDocuments(organizationId);
      rows = await read();
    }
    return rows.map(resolve);
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while loading the PDF documents.",
      additionalData: { organizationId },
      label,
    });
  }
}

/**
 * Picks the document a booking PDF prints with.
 *
 * - An explicitly `requestedId` must be one of this workspace's documents;
 *   anything else, another workspace's document included, is a 404.
 * - Otherwise the `rememberedId` (the caller's last pick) when it still
 *   exists in this workspace, then the default document.
 *
 * @param params.organizationId - The caller's workspace
 * @param params.requestedId - The `?document=` id, when the URL names one
 * @param params.rememberedId - The last document this person printed with here
 * @returns The document and every document of the workspace, for the picker
 * @throws {ShelfError} 404 when `requestedId` is not a document of the workspace
 */
export async function resolvePdfDocumentForPrint({
  organizationId,
  requestedId,
  rememberedId,
}: {
  organizationId: string;
  requestedId?: string | null;
  rememberedId?: string | null;
}): Promise<{
  document: ResolvedPdfDocument;
  documents: ResolvedPdfDocument[];
}> {
  const documents = await getPdfDocuments({ organizationId });

  if (requestedId) {
    const requested = documents.find((document) => document.id === requestedId);
    if (!requested) {
      throw new ShelfError({
        cause: null,
        title: "Document not found",
        message:
          "This document does not exist in your workspace. It may have been deleted. Pick another document.",
        additionalData: { organizationId, requestedId },
        label,
        status: 404,
        shouldBeCaptured: false,
      });
    }
    return { document: requested, documents };
  }

  const document =
    documents.find((s) => s.id === rememberedId) ??
    documents.find((s) => s.isDefault) ??
    documents[0];

  return { document, documents };
}

/** Turns a duplicate-name write into a message for the form. */
function rethrowNameTaken(cause: unknown, name: string): never {
  if (
    cause &&
    typeof cause === "object" &&
    "code" in cause &&
    cause.code === "P2002"
  ) {
    throw new ShelfError({
      cause,
      title: "Name already used",
      message: `A document called "${name}" already exists. Pick another name.`,
      label,
      status: 400,
      shouldBeCaptured: false,
      additionalData: { name },
    });
  }
  throw cause;
}

/** Wraps an unexpected failure; refusals keep their own status. */
function wrap(cause: unknown, message: string, organizationId: string): never {
  if (isLikeShelfError(cause)) throw cause;
  throw new ShelfError({
    cause,
    message,
    additionalData: { organizationId },
    label,
  });
}

/**
 * Locks every document of the workspace until the transaction ends, so two
 * concurrent deletes or default changes run one after the other and the
 * keep-one and one-default rules see each other's result.
 */
async function lockWorkspaceDocuments(tx: TxClient, organizationId: string) {
  await tx.$queryRaw`SELECT "id" FROM "PdfDocument" WHERE "organizationId" = ${organizationId} FOR UPDATE`;
}

async function findDocumentOrThrow(
  tx: TxClient,
  { organizationId, documentId }: { organizationId: string; documentId: string }
) {
  const document = await tx.pdfDocument.findFirst({
    where: { id: documentId, organizationId, kind: KIND },
    select: DOCUMENT_SELECT,
  });
  if (!document) {
    throw new ShelfError({
      cause: null,
      title: "Document not found",
      message: "This document does not exist in your workspace.",
      additionalData: { organizationId, documentId },
      label,
      status: 404,
      shouldBeCaptured: false,
    });
  }
  return document;
}

/**
 * Adds a document laid out like the Checklist document.
 *
 * @param params.organizationId - The caller's workspace
 * @param params.name - The new document's name, unique in the workspace
 * @returns The new document
 * @throws {ShelfError} 400 when the name is taken
 */
export async function createPdfDocument({
  organizationId,
  name,
}: {
  organizationId: string;
  name: string;
}) {
  try {
    // A workspace without documents gets the built-in ones first, so the new
    // document is never the only one and never the default.
    await getPdfDocuments({ organizationId });
    await assertNameFree(db, { organizationId, name });
    return await db.pdfDocument
      .create({
        data: {
          organizationId,
          name,
          kind: KIND,
          config: BOOKING_CHECKLIST_CONFIG,
        },
        select: DOCUMENT_SELECT,
      })
      .then(resolve)
      .catch((cause) => rethrowNameTaken(cause, name));
  } catch (cause) {
    wrap(
      cause,
      "Something went wrong while adding the document.",
      organizationId
    );
  }
}

/**
 * Refuses a name another document of the workspace already has, ignoring case,
 * so the picker never lists two documents that read the same.
 *
 * @param params.exceptId - The document being renamed, which may keep its name
 * @throws {ShelfError} 400 when the name is taken
 */
async function assertNameFree(
  client: Pick<TxClient, "pdfDocument">,
  {
    organizationId,
    name,
    exceptId,
  }: { organizationId: string; name: string; exceptId?: string }
) {
  const clash = await client.pdfDocument.findFirst({
    where: {
      organizationId,
      kind: KIND,
      name: { equals: name, mode: "insensitive" },
      ...(exceptId && { id: { not: exceptId } }),
    },
    select: { id: true },
  });
  if (clash) rethrowNameTaken({ code: "P2002" }, name);
}

/**
 * Picks "Copy of <name>", then "Copy of <name> (2)", and so on, until the
 * name is free in the workspace (ignoring case). The source name is cut so
 * the copy still fits {@link MAX_DOCUMENT_NAME_LENGTH}.
 */
function copyName(name: string, taken: string[]) {
  const lower = new Set(taken.map((t) => t.toLowerCase()));
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? "" : ` (${n})`;
    const room = MAX_DOCUMENT_NAME_LENGTH - "Copy of ".length - suffix.length;
    const candidate = `Copy of ${name.slice(0, room).trimEnd()}${suffix}`;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * Adds a copy of a document, named "Copy of <name>". The copy is never the
 * default.
 *
 * @param params.organizationId - The caller's workspace
 * @param params.documentId - The document to copy
 * @returns The copy
 * @throws {ShelfError} 404 when the document is not in the workspace
 */
export async function duplicatePdfDocument({
  organizationId,
  documentId,
}: {
  organizationId: string;
  documentId: string;
}) {
  try {
    return await db.$transaction(async (tx) => {
      const source = await findDocumentOrThrow(tx, {
        organizationId,
        documentId,
      });
      const names = await tx.pdfDocument.findMany({
        where: { organizationId, kind: KIND },
        select: { name: true },
      });
      const name = copyName(
        source.name,
        names.map((n) => n.name)
      );
      return tx.pdfDocument
        .create({
          data: {
            organizationId,
            name,
            kind: KIND,
            config: parseBookingDocumentConfig(source.config),
          },
          select: DOCUMENT_SELECT,
        })
        .then(resolve)
        .catch((cause) => rethrowNameTaken(cause, name));
    });
  } catch (cause) {
    wrap(
      cause,
      "Something went wrong while duplicating the document.",
      organizationId
    );
  }
}

/**
 * Proves every custom field a document names is a live field of the workspace
 * that is not deleted. Every custom field type prints: most as a column, a
 * multi-line text in the description row.
 *
 * @throws {ShelfError} 400 when there are too many, or one is foreign or
 *   deleted
 */
async function assertPrintableCustomFields(
  tx: TxClient,
  {
    organizationId,
    customFieldIds,
  }: { organizationId: string; customFieldIds: string[] }
) {
  if (customFieldIds.length > MAX_DOCUMENT_CUSTOM_FIELDS) {
    throw new ShelfError({
      cause: null,
      title: "Too many custom fields",
      message: `A document prints at most ${MAX_DOCUMENT_CUSTOM_FIELDS} custom fields.`,
      label,
      status: 400,
      shouldBeCaptured: false,
      additionalData: { organizationId, count: customFieldIds.length },
    });
  }

  if (customFieldIds.length === 0) return;

  await assertCustomFieldsBelongToOrg({ customFieldIds, organizationId }, tx);

  const live = await tx.customField.count({
    where: { id: { in: customFieldIds }, organizationId, deletedAt: null },
  });
  if (live !== customFieldIds.length) {
    throw new ShelfError({
      cause: null,
      title: "Custom field deleted",
      message:
        "One of the chosen custom fields was deleted. Reload the page and pick again.",
      label,
      status: 400,
      shouldBeCaptured: false,
      additionalData: { organizationId },
    });
  }
}

/**
 * Saves a document's name and switches.
 *
 * @param params.organizationId - The caller's workspace
 * @param params.documentId - The document to save
 * @param params.name - Its name, unique in the workspace
 * @param params.config - Its switches
 * @returns The saved document
 * @throws {ShelfError} 400 for a taken name or an unprintable custom field,
 *   404 when the document is not in the workspace
 */
export async function updatePdfDocument({
  organizationId,
  documentId,
  name,
  config,
}: {
  organizationId: string;
  documentId: string;
  name: string;
  config: BookingDocumentConfig;
}) {
  try {
    return await db.$transaction(async (tx) => {
      await findDocumentOrThrow(tx, { organizationId, documentId });
      await assertNameFree(tx, { organizationId, name, exceptId: documentId });
      await assertPrintableCustomFields(tx, {
        organizationId,
        customFieldIds: config.customFieldIds,
      });
      return tx.pdfDocument
        .update({
          where: { id: documentId, organizationId },
          data: { name, config },
          select: DOCUMENT_SELECT,
        })
        .then(resolve)
        .catch((cause) => rethrowNameTaken(cause, name));
    });
  } catch (cause) {
    wrap(
      cause,
      "Something went wrong while saving the document.",
      organizationId
    );
  }
}

/**
 * Makes a document the one the print dialog offers first.
 *
 * @param params.organizationId - The caller's workspace
 * @param params.documentId - The new default
 * @throws {ShelfError} 404 when the document is not in the workspace
 */
export async function setDefaultPdfDocument({
  organizationId,
  documentId,
}: {
  organizationId: string;
  documentId: string;
}) {
  try {
    await db.$transaction(async (tx) => {
      await lockWorkspaceDocuments(tx, organizationId);
      await findDocumentOrThrow(tx, { organizationId, documentId });
      // Clear first: one default per workspace is a unique index.
      await tx.pdfDocument.updateMany({
        where: { organizationId, kind: KIND, isDefault: true },
        data: { isDefault: false },
      });
      await tx.pdfDocument.update({
        where: { id: documentId, organizationId },
        data: { isDefault: true },
      });
    });
  } catch (cause) {
    wrap(
      cause,
      "Something went wrong while changing the default document.",
      organizationId
    );
  }
}

/**
 * Deletes a document. The last document of a workspace cannot be deleted. Deleting
 * the default makes the oldest remaining document the default.
 *
 * @param params.organizationId - The caller's workspace
 * @param params.documentId - The document to delete
 * @throws {ShelfError} 400 for the last document, 404 when the document is not in
 *   the workspace
 */
export async function deletePdfDocument({
  organizationId,
  documentId,
}: {
  organizationId: string;
  documentId: string;
}) {
  try {
    await db.$transaction(async (tx) => {
      await lockWorkspaceDocuments(tx, organizationId);
      const document = await findDocumentOrThrow(tx, {
        organizationId,
        documentId,
      });
      const remaining = await tx.pdfDocument.findMany({
        where: { organizationId, kind: KIND, id: { not: documentId } },
        select: { id: true },
        orderBy: [{ createdAt: "asc" }, { name: "asc" }],
        take: 1,
      });

      if (remaining.length === 0) {
        throw new ShelfError({
          cause: null,
          title: "Keep one document",
          message:
            "A workspace always keeps at least one document. Add another document before you delete this one.",
          label,
          status: 400,
          shouldBeCaptured: false,
          additionalData: { organizationId, documentId },
        });
      }

      await tx.pdfDocument.delete({
        where: { id: documentId, organizationId },
      });

      if (document.isDefault) {
        await tx.pdfDocument.update({
          where: { id: remaining[0].id, organizationId },
          data: { isDefault: true },
        });
      }
    });
  } catch (cause) {
    wrap(
      cause,
      "Something went wrong while deleting the document.",
      organizationId
    );
  }
}
