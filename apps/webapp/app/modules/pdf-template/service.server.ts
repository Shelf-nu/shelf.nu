/**
 * Printed Template Service
 *
 * Reads and writes a workspace's PDF templates: the named layouts of the
 * booking PDF. Every function takes the caller's `organizationId` and scopes
 * every query by it, so a template id from another workspace reads as not found.
 *
 * A workspace that can use bookings always has at least one template and
 * exactly one default. New team workspaces get the built-in templates when they
 * are created; a workspace that has none gets them the first time its
 * templates are read. Callers gate on `canUseBookings`; this module does not. Template names are unique per workspace, ignoring case.
 *
 * @see {@link file://./config.ts}
 * @see {@link file://../../routes/_layout+/settings.general.tsx}
 * @see {@link file://../../routes/api+/bookings.$bookingId.generate-pdf.tsx}
 */
import type { Prisma, PdfTemplate } from "@prisma/client";
import { PdfTemplateKind } from "@prisma/client";
import type { ITXClientDenyList } from "@prisma/client/runtime/library";
import type { ExtendedPrismaClient } from "~/database/db.server";
import { db } from "~/database/db.server";
import { isLikeShelfError, ShelfError } from "~/utils/error";
import { assertCustomFieldsBelongToOrg } from "~/utils/org-validation.server";
import type { BookingTemplateConfig } from "./config";
import {
  BOOKING_CHECKLIST_CONFIG,
  builtInBookingTemplates,
  MAX_TEMPLATE_CUSTOM_FIELDS,
  MAX_TEMPLATE_NAME_LENGTH,
  parseBookingTemplateConfig,
} from "./config";

const label = "PDF templates";

type TxClient = Omit<ExtendedPrismaClient, ITXClientDenyList>;

const KIND = PdfTemplateKind.BOOKING;

/** A PDF template with its config parsed. */
export type ResolvedPdfTemplate = Pick<
  PdfTemplate,
  "id" | "name" | "isDefault"
> & { config: BookingTemplateConfig };

const TEMPLATE_SELECT = {
  id: true,
  name: true,
  isDefault: true,
  config: true,
} satisfies Prisma.PdfTemplateSelect;

/** List order: the default first, then the order the templates were made in. */
const TEMPLATE_ORDER = [
  { isDefault: "desc" },
  { createdAt: "asc" },
  { name: "asc" },
] satisfies Prisma.PdfTemplateOrderByWithRelationInput[];

function resolve(
  row: Prisma.PdfTemplateGetPayload<{ select: typeof TEMPLATE_SELECT }>
): ResolvedPdfTemplate {
  return {
    id: row.id,
    name: row.name,
    isDefault: row.isDefault,
    config: parseBookingTemplateConfig(row.config),
  };
}

/**
 * The built-in templates of a new team workspace, as the `pdfTemplates` field
 * of its `OrganizationCreateInput`: the Checklist (default) and the Check-out
 * receipt.
 *
 * @returns `pdfTemplates`, to spread into the create input
 */
export function pdfTemplatesForNewWorkspace() {
  return {
    pdfTemplates: {
      createMany: {
        data: builtInBookingTemplates().map((template) => ({
          name: template.name,
          kind: KIND,
          config: template.config,
          isDefault: template.isDefault,
        })),
      },
    },
  } satisfies Pick<Prisma.OrganizationCreateInput, "pdfTemplates">;
}

/**
 * Every booking template of a workspace, default first. A workspace that has
 * none (one created before templates, or by a path that seeds nothing) gets
 * both built-ins the first time it reads them. Idempotent: two concurrent
 * calls create each built-in once, because the name and the default are both
 * unique per workspace.
 *
 * Callers must have checked `canUseBookings` first (`~/utils/subscription.server`):
 * this module cannot import it without an import cycle through the user
 * service, so it does not gate on the workspace type itself.
 *
 * @param params.organizationId - The caller's workspace
 * @returns The templates with their configs parsed
 * @throws {ShelfError} 500 when the read fails
 */
export async function getPdfTemplates({
  organizationId,
}: {
  organizationId: string;
}): Promise<ResolvedPdfTemplate[]> {
  try {
    const read = () =>
      db.pdfTemplate.findMany({
        where: { organizationId, kind: KIND },
        select: TEMPLATE_SELECT,
        orderBy: TEMPLATE_ORDER,
      });
    let rows = await read();
    if (rows.length === 0) {
      await db.pdfTemplate.createMany({
        data: builtInBookingTemplates().map((template) => ({
          organizationId,
          name: template.name,
          kind: KIND,
          config: template.config,
          isDefault: template.isDefault,
        })),
        skipDuplicates: true,
      });
      rows = await read();
    }
    return rows.map(resolve);
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while loading the PDF templates.",
      additionalData: { organizationId },
      label,
    });
  }
}

/**
 * Picks the template a booking PDF prints with.
 *
 * - An explicitly `requestedId` must be one of this workspace's templates;
 *   anything else, another workspace's template included, is a 404.
 * - Otherwise the `rememberedId` (the caller's last pick) when it still
 *   exists in this workspace, then the default template.
 *
 * @param params.organizationId - The caller's workspace
 * @param params.requestedId - The `?template=` id, when the URL names one
 * @param params.rememberedId - The last template this person printed with here
 * @returns The template and every template of the workspace, for the picker
 * @throws {ShelfError} 404 when `requestedId` is not a template of the workspace
 */
export async function resolvePdfTemplateForPrint({
  organizationId,
  requestedId,
  rememberedId,
}: {
  organizationId: string;
  requestedId?: string | null;
  rememberedId?: string | null;
}): Promise<{
  template: ResolvedPdfTemplate;
  templates: ResolvedPdfTemplate[];
}> {
  const templates = await getPdfTemplates({ organizationId });

  if (requestedId) {
    const requested = templates.find((template) => template.id === requestedId);
    if (!requested) {
      throw new ShelfError({
        cause: null,
        title: "Template not found",
        message:
          "This template does not exist in your workspace. It may have been deleted. Pick another template.",
        additionalData: { organizationId, requestedId },
        label,
        status: 404,
        shouldBeCaptured: false,
      });
    }
    return { template: requested, templates };
  }

  const template =
    templates.find((s) => s.id === rememberedId) ??
    templates.find((s) => s.isDefault) ??
    templates[0];

  return { template, templates };
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
      message: `A template called "${name}" already exists. Pick another name.`,
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
 * Locks every template of the workspace until the transaction ends, so two
 * concurrent deletes or default changes run one after the other and the
 * keep-one and one-default rules see each other's result.
 */
async function lockWorkspaceTemplates(tx: TxClient, organizationId: string) {
  await tx.$queryRaw`SELECT "id" FROM "PdfTemplate" WHERE "organizationId" = ${organizationId} FOR UPDATE`;
}

async function findTemplateOrThrow(
  tx: TxClient,
  { organizationId, templateId }: { organizationId: string; templateId: string }
) {
  const template = await tx.pdfTemplate.findFirst({
    where: { id: templateId, organizationId, kind: KIND },
    select: TEMPLATE_SELECT,
  });
  if (!template) {
    throw new ShelfError({
      cause: null,
      title: "Template not found",
      message: "This template does not exist in your workspace.",
      additionalData: { organizationId, templateId },
      label,
      status: 404,
      shouldBeCaptured: false,
    });
  }
  return template;
}

/**
 * Adds a template laid out like the Checklist template.
 *
 * @param params.organizationId - The caller's workspace
 * @param params.name - The new template's name, unique in the workspace
 * @returns The new template
 * @throws {ShelfError} 400 when the name is taken
 */
export async function createPdfTemplate({
  organizationId,
  name,
}: {
  organizationId: string;
  name: string;
}) {
  try {
    // A workspace without templates gets the built-in ones first, so the new
    // template is never the only one and never the default.
    await getPdfTemplates({ organizationId });
    await assertNameFree(db, { organizationId, name });
    return await db.pdfTemplate
      .create({
        data: {
          organizationId,
          name,
          kind: KIND,
          config: BOOKING_CHECKLIST_CONFIG,
        },
        select: TEMPLATE_SELECT,
      })
      .then(resolve)
      .catch((cause) => rethrowNameTaken(cause, name));
  } catch (cause) {
    wrap(
      cause,
      "Something went wrong while adding the template.",
      organizationId
    );
  }
}

/**
 * Refuses a name another template of the workspace already has, ignoring case,
 * so the picker never lists two templates that read the same.
 *
 * @param params.exceptId - The template being renamed, which may keep its name
 * @throws {ShelfError} 400 when the name is taken
 */
async function assertNameFree(
  client: Pick<TxClient, "pdfTemplate">,
  {
    organizationId,
    name,
    exceptId,
  }: { organizationId: string; name: string; exceptId?: string }
) {
  const clash = await client.pdfTemplate.findFirst({
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
 * the copy still fits {@link MAX_TEMPLATE_NAME_LENGTH}.
 */
function copyName(name: string, taken: string[]) {
  const lower = new Set(taken.map((t) => t.toLowerCase()));
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? "" : ` (${n})`;
    const room = MAX_TEMPLATE_NAME_LENGTH - "Copy of ".length - suffix.length;
    const candidate = `Copy of ${name.slice(0, room).trimEnd()}${suffix}`;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * Adds a copy of a template, named "Copy of <name>". The copy is never the
 * default.
 *
 * @param params.organizationId - The caller's workspace
 * @param params.templateId - The template to copy
 * @returns The copy
 * @throws {ShelfError} 404 when the template is not in the workspace
 */
export async function duplicatePdfTemplate({
  organizationId,
  templateId,
}: {
  organizationId: string;
  templateId: string;
}) {
  try {
    return await db.$transaction(async (tx) => {
      // Two copies made at once would both pick the same free name.
      await lockWorkspaceTemplates(tx, organizationId);
      const source = await findTemplateOrThrow(tx, {
        organizationId,
        templateId,
      });
      const names = await tx.pdfTemplate.findMany({
        where: { organizationId, kind: KIND },
        select: { name: true },
      });
      const name = copyName(
        source.name,
        names.map((n) => n.name)
      );
      return tx.pdfTemplate
        .create({
          data: {
            organizationId,
            name,
            kind: KIND,
            config: parseBookingTemplateConfig(source.config),
          },
          select: TEMPLATE_SELECT,
        })
        .then(resolve)
        .catch((cause) => rethrowNameTaken(cause, name));
    });
  } catch (cause) {
    wrap(
      cause,
      "Something went wrong while duplicating the template.",
      organizationId
    );
  }
}

/**
 * Proves every custom field a template names is a live field of the workspace
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
  if (customFieldIds.length > MAX_TEMPLATE_CUSTOM_FIELDS) {
    throw new ShelfError({
      cause: null,
      title: "Too many custom fields",
      message: `A template prints at most ${MAX_TEMPLATE_CUSTOM_FIELDS} custom fields.`,
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
 * Saves a template's name and switches.
 *
 * @param params.organizationId - The caller's workspace
 * @param params.templateId - The template to save
 * @param params.name - Its name, unique in the workspace
 * @param params.config - Its switches
 * @returns The saved template
 * @throws {ShelfError} 400 for a taken name or an unprintable custom field,
 *   404 when the template is not in the workspace
 */
export async function updatePdfTemplate({
  organizationId,
  templateId,
  name,
  config,
}: {
  organizationId: string;
  templateId: string;
  name: string;
  config: BookingTemplateConfig;
}) {
  try {
    return await db.$transaction(async (tx) => {
      await findTemplateOrThrow(tx, { organizationId, templateId });
      await assertNameFree(tx, { organizationId, name, exceptId: templateId });
      await assertPrintableCustomFields(tx, {
        organizationId,
        customFieldIds: config.customFieldIds,
      });
      return tx.pdfTemplate
        .update({
          where: { id: templateId, organizationId },
          data: { name, config },
          select: TEMPLATE_SELECT,
        })
        .then(resolve)
        .catch((cause) => rethrowNameTaken(cause, name));
    });
  } catch (cause) {
    wrap(
      cause,
      "Something went wrong while saving the template.",
      organizationId
    );
  }
}

/**
 * Makes a template the one the print dialog offers first.
 *
 * @param params.organizationId - The caller's workspace
 * @param params.templateId - The new default
 * @throws {ShelfError} 404 when the template is not in the workspace
 */
export async function setDefaultPdfTemplate({
  organizationId,
  templateId,
}: {
  organizationId: string;
  templateId: string;
}) {
  try {
    await db.$transaction(async (tx) => {
      await lockWorkspaceTemplates(tx, organizationId);
      await findTemplateOrThrow(tx, { organizationId, templateId });
      // Clear first: one default per workspace is a unique index.
      await tx.pdfTemplate.updateMany({
        where: { organizationId, kind: KIND, isDefault: true },
        data: { isDefault: false },
      });
      await tx.pdfTemplate.update({
        where: { id: templateId, organizationId },
        data: { isDefault: true },
      });
    });
  } catch (cause) {
    wrap(
      cause,
      "Something went wrong while changing the default template.",
      organizationId
    );
  }
}

/**
 * Deletes a template. The last template of a workspace cannot be deleted. Deleting
 * the default makes the oldest remaining template the default.
 *
 * @param params.organizationId - The caller's workspace
 * @param params.templateId - The template to delete
 * @throws {ShelfError} 400 for the last template, 404 when the template is not in
 *   the workspace
 */
export async function deletePdfTemplate({
  organizationId,
  templateId,
}: {
  organizationId: string;
  templateId: string;
}) {
  try {
    await db.$transaction(async (tx) => {
      await lockWorkspaceTemplates(tx, organizationId);
      const template = await findTemplateOrThrow(tx, {
        organizationId,
        templateId,
      });
      const remaining = await tx.pdfTemplate.findMany({
        where: { organizationId, kind: KIND, id: { not: templateId } },
        select: { id: true },
        orderBy: [{ createdAt: "asc" }, { name: "asc" }],
        take: 1,
      });

      if (remaining.length === 0) {
        throw new ShelfError({
          cause: null,
          title: "Keep one template",
          message:
            "A workspace always keeps at least one template. Add another template before you delete this one.",
          label,
          status: 400,
          shouldBeCaptured: false,
          additionalData: { organizationId, templateId },
        });
      }

      await tx.pdfTemplate.delete({
        where: { id: templateId, organizationId },
      });

      if (template.isDefault) {
        await tx.pdfTemplate.update({
          where: { id: remaining[0].id, organizationId },
          data: { isDefault: true },
        });
      }
    });
  } catch (cause) {
    wrap(
      cause,
      "Something went wrong while deleting the template.",
      organizationId
    );
  }
}
