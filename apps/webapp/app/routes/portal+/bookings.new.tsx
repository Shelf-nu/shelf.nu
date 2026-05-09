import { BookingStatus } from "@prisma/client";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import {
  data,
  redirect,
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { z } from "zod";
import { PortalButton } from "~/components/portal/portal-button";
import { PortalCard } from "~/components/portal/portal-card";
import { PortalChip } from "~/components/portal/portal-chip";
import { PortalIcon } from "~/components/portal/portal-icon";
import { db } from "~/database/db.server";
import { createBooking } from "~/modules/booking/service.server";
import {
  ensurePortalTeamMember,
  requirePortalUser,
} from "~/modules/portal/portal.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { getClientHint } from "~/utils/client-hints";
import {
  ShelfError,
  isLikeShelfError,
  isZodValidationError,
  makeShelfError,
} from "~/utils/error";
import { error, getActionMethod, parseData } from "~/utils/http.server";

export const meta: MetaFunction = () => [
  { title: appendToMetaTitle("Riepilogo prenotazione") },
];

const QuerySchema = z.object({
  assetId: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
});

export async function loader({ context, request }: LoaderFunctionArgs) {
  const user = await requirePortalUser(context, request);
  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse({
    assetId: url.searchParams.get("assetId") ?? "",
    from: url.searchParams.get("from") ?? "",
    to: url.searchParams.get("to") ?? "",
  });
  if (!parsed.success) {
    throw redirect("/portal/catalog");
  }
  const { assetId, from, to } = parsed.data;

  const asset = await db.asset.findFirst({
    where: {
      id: assetId,
      organizationId: user.organizationId,
      availableToBook: true,
    },
    select: {
      id: true,
      title: true,
      description: true,
      thumbnailImage: true,
      mainImage: true,
      category: { select: { name: true } },
    },
  });
  if (!asset) {
    throw new ShelfError({
      cause: null,
      message: "Strumento non trovato",
      label: "Portal",
      status: 404,
    });
  }

  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (
    Number.isNaN(fromDate.getTime()) ||
    Number.isNaN(toDate.getTime()) ||
    toDate <= fromDate
  ) {
    throw new ShelfError({
      cause: null,
      message: "Date non valide",
      label: "Portal",
      status: 400,
    });
  }

  return {
    user,
    asset,
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
  };
}

const BodySchema = z.object({
  assetId: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  description: z.string().max(2000).optional(),
});

export async function action({ context, request }: ActionFunctionArgs) {
  try {
    if (getActionMethod(request) !== "POST") {
      throw new ShelfError({
        cause: null,
        message: "Method not allowed",
        label: "Portal",
        status: 405,
      });
    }
    const user = await requirePortalUser(context, request);
    const formData = await request.formData();
    const { assetId, from, to, description } = parseData(formData, BodySchema, {
      shouldBeCaptured: false,
    });

    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (
      Number.isNaN(fromDate.getTime()) ||
      Number.isNaN(toDate.getTime()) ||
      toDate <= fromDate
    ) {
      throw new ShelfError({
        cause: null,
        message: "Date non valide.",
        label: "Portal",
        status: 400,
      });
    }

    const asset = await db.asset.findFirst({
      where: {
        id: assetId,
        organizationId: user.organizationId,
        availableToBook: true,
      },
      select: { id: true, title: true },
    });
    if (!asset) {
      throw new ShelfError({
        cause: null,
        message: "Strumento non trovato.",
        label: "Portal",
        status: 404,
      });
    }

    // Conflict pre-check: portal auto-RESERVES, so we must enforce
    // non-overlap up front (shelf core only checks on the DRAFT→RESERVED
    // transition, which we bypass via direct status update below).
    // Two intervals [a,b) and [c,d) overlap iff a < d AND c < b.
    const conflict = await db.booking.findFirst({
      where: {
        organizationId: user.organizationId,
        status: { in: ["RESERVED", "ONGOING", "OVERDUE"] },
        assets: { some: { id: asset.id } },
        from: { lt: toDate },
        to: { gt: fromDate },
      },
      select: { from: true, to: true },
    });
    if (conflict) {
      const fmt = (d: Date) =>
        d.toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
      throw new ShelfError({
        cause: null,
        message: `Lo strumento è già prenotato dal ${fmt(
          conflict.from
        )} al ${fmt(conflict.to)}. Scegli un altro periodo.`,
        label: "Portal",
        status: 409,
        shouldBeCaptured: false,
      });
    }

    const displayName =
      [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
    const teamMemberId = await ensurePortalTeamMember(
      user.id,
      user.organizationId,
      displayName
    );

    const created = await createBooking({
      booking: {
        name: `Richiesta — ${asset.title}`,
        description: description ?? "",
        creatorId: user.id,
        custodianUserId: user.id,
        custodianTeamMemberId: teamMemberId,
        organizationId: user.organizationId,
        from: fromDate,
        to: toDate,
        tags: [],
      },
      assetIds: [asset.id],
      hints: getClientHint(request),
    });

    // Approval policy lives in canSelfCheckout (see portal.server.ts):
    // SELF_SERVICE / OWNER / ADMIN auto-RESERVE; BASE stays DRAFT for
    // admin review. The popup card below uses the same flag, so what the
    // user sees and what the action does cannot drift.
    if (user.canSelfCheckout) {
      await db.booking.update({
        where: { id: created.id },
        data: { status: BookingStatus.RESERVED },
      });
    }

    return redirect(`/portal/bookings/${created.id}?created=1`);
  } catch (cause) {
    // requirePortalUser throws a redirect Response on un-authed access — let it bubble.
    if (cause instanceof Response) throw cause;
    const reason = makeShelfError(
      cause,
      undefined,
      isLikeShelfError(cause)
        ? cause.shouldBeCaptured
        : !isZodValidationError(cause)
    );
    return data(error(reason), { status: reason.status });
  }
}

export default function PortalBookingNew() {
  const { user, asset, from, to } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const disabled = nav.state !== "idle";
  const errMsg =
    actionData && "error" in actionData ? actionData.error.message : null;

  const fromDate = new Date(from);
  const toDate = new Date(to);
  const formatDate = (d: Date) =>
    d.toLocaleString("it-IT", {
      dateStyle: "full",
      timeStyle: "short",
    });

  return (
    <section className="mx-auto max-w-2xl px-4 py-6">
      <Link
        to={`/portal/catalog/${asset.id}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-[var(--portal-on-surface-variant)] hover:text-[var(--portal-primary)]"
      >
        <PortalIcon name="arrow_back" /> Torna allo strumento
      </Link>

      <h1 className="portal-h2 mb-2">Riepilogo prenotazione</h1>
      <p className="mb-6 text-[var(--portal-on-surface-variant)]">
        Verifica i dettagli prima di confermare la richiesta.
      </p>

      <PortalCard className="mb-4">
        <h2 className="portal-h3 mb-3">Strumento</h2>
        <div className="flex gap-3">
          <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[var(--portal-surface-container)]">
            {asset.thumbnailImage || asset.mainImage ? (
              <img
                src={asset.thumbnailImage ?? asset.mainImage ?? undefined}
                alt={asset.title}
                className="size-full object-cover"
              />
            ) : (
              <PortalIcon
                name="construction"
                className="text-3xl text-[var(--portal-outline)]"
              />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold">{asset.title}</div>
            {asset.category && (
              <PortalChip tone="secondary" className="mt-1">
                {asset.category.name}
              </PortalChip>
            )}
            {asset.description && (
              <p className="mt-2 line-clamp-3 text-sm text-[var(--portal-on-surface-variant)]">
                {asset.description}
              </p>
            )}
          </div>
        </div>
      </PortalCard>

      <PortalCard className="mb-4">
        <h2 className="portal-h3 mb-3">Periodo</h2>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="portal-label text-[var(--portal-on-surface-variant)]">
              Inizio
            </dt>
            <dd className="mt-1 font-semibold">{formatDate(fromDate)}</dd>
          </div>
          <div>
            <dt className="portal-label text-[var(--portal-on-surface-variant)]">
              Fine
            </dt>
            <dd className="mt-1 font-semibold">{formatDate(toDate)}</dd>
          </div>
        </dl>
      </PortalCard>

      <PortalCard className="mb-4">
        <h2 className="portal-h3 mb-3">Note (facoltative)</h2>
        <Form method="post" id="confirm-form" className="flex flex-col gap-3">
          <input type="hidden" name="assetId" value={asset.id} />
          <input type="hidden" name="from" value={from} />
          <input type="hidden" name="to" value={to} />
          <textarea
            name="description"
            rows={3}
            placeholder="Eventuali dettagli per chi gestisce il prestito…"
            className="w-full"
          />
        </Form>
      </PortalCard>

      <PortalCard
        accent={user.canSelfCheckout ? "secondary" : "primary"}
        className="mb-6"
      >
        <div className="flex items-start gap-3">
          <PortalIcon
            name={user.canSelfCheckout ? "check_circle" : "schedule"}
            className={`text-2xl ${
              user.canSelfCheckout
                ? "text-[var(--portal-secondary)]"
                : "text-[var(--portal-primary)]"
            }`}
          />
          <div>
            <div className="mb-1 font-semibold">
              {user.canSelfCheckout
                ? "Prenotazione automatica"
                : "Richiede approvazione"}
            </div>
            <p className="text-sm text-[var(--portal-on-surface-variant)]">
              {user.canSelfCheckout
                ? "Il tuo account ha i permessi per confermare direttamente la prenotazione."
                : "La tua richiesta sarà esaminata da un amministratore. Riceverai una notifica con l'esito."}
            </p>
          </div>
        </div>
      </PortalCard>

      {errMsg && (
        <div className="mb-4 rounded-lg bg-[var(--portal-error-container)] px-3 py-2 text-sm text-[var(--portal-on-error-container)]">
          {errMsg}
        </div>
      )}

      <PortalButton
        type="submit"
        size="lg"
        disabled={disabled}
        className="w-full"
        form="confirm-form"
      >
        {disabled
          ? "Invio in corso…"
          : user.canSelfCheckout
          ? "Conferma prenotazione"
          : "Invia richiesta"}
      </PortalButton>
    </section>
  );
}
