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
  useLoaderData,
  useNavigation,
} from "react-router";
import { PortalButton } from "~/components/portal/portal-button";
import { PortalCard } from "~/components/portal/portal-card";
import { PortalChip } from "~/components/portal/portal-chip";
import { PortalIcon } from "~/components/portal/portal-icon";
import { db } from "~/database/db.server";
import { useSearchParams } from "~/hooks/search-params";
import { requirePortalUser } from "~/modules/portal/portal.server";
import { STATUS_LABEL, STATUS_TONE } from "~/modules/portal/portal.shared";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { ShelfError, isLikeShelfError, makeShelfError } from "~/utils/error";
import { error, getActionMethod } from "~/utils/http.server";

export const meta: MetaFunction = () => [
  { title: appendToMetaTitle("Prenotazione") },
];

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const user = await requirePortalUser(context, request);
  const { bookingId } = params;
  if (!bookingId) throw redirect("/portal/bookings");

  const booking = await db.booking.findFirst({
    where: {
      id: bookingId,
      creatorId: user.id,
      organizationId: user.organizationId,
    },
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      from: true,
      to: true,
      createdAt: true,
      cancellationReason: true,
      assets: {
        select: {
          id: true,
          title: true,
          description: true,
          thumbnailImage: true,
          mainImage: true,
          category: { select: { name: true } },
        },
      },
    },
  });

  if (!booking) {
    throw new ShelfError({
      cause: null,
      message: "Prenotazione non trovata",
      label: "Portal",
      status: 404,
    });
  }

  return { booking };
}

export async function action({ context, request, params }: ActionFunctionArgs) {
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
    const { bookingId } = params;
    if (!bookingId) throw redirect("/portal/bookings");

    const formData = await request.formData();
    const intent = formData.get("intent");
    if (intent !== "cancel") {
      throw new ShelfError({
        cause: null,
        message: "Intent non valido",
        label: "Portal",
        status: 400,
      });
    }

    // Only DRAFT or RESERVED bookings owned by this user can be cancelled.
    const booking = await db.booking.findFirst({
      where: {
        id: bookingId,
        creatorId: user.id,
        organizationId: user.organizationId,
        status: { in: [BookingStatus.DRAFT, BookingStatus.RESERVED] },
      },
      select: { id: true },
    });
    if (!booking) {
      throw new ShelfError({
        cause: null,
        message: "Questa prenotazione non può essere annullata.",
        label: "Portal",
        status: 400,
      });
    }

    await db.booking.update({
      where: { id: booking.id },
      data: {
        status: BookingStatus.CANCELLED,
        cancellationReason: "Annullata dall'utente dal portale",
      },
    });

    return redirect(`/portal/bookings/${booking.id}`);
  } catch (cause) {
    if (cause instanceof Response) throw cause;
    const reason = makeShelfError(
      cause,
      undefined,
      isLikeShelfError(cause) ? cause.shouldBeCaptured : true
    );
    return data(error(reason), { status: reason.status });
  }
}

export default function PortalBookingDetail() {
  const { booking } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const justCreated = searchParams.get("created") === "1";
  const nav = useNavigation();
  const submitting = nav.state !== "idle";

  const asset = booking.assets[0];
  const canCancel =
    booking.status === BookingStatus.DRAFT ||
    booking.status === BookingStatus.RESERVED;

  const formatDate = (d: Date) =>
    new Date(d).toLocaleString("it-IT", {
      dateStyle: "full",
      timeStyle: "short",
    });

  return (
    <section className="mx-auto max-w-2xl px-4 py-6">
      <Link
        to="/portal/bookings"
        className="mb-4 inline-flex items-center gap-1 text-sm text-[var(--portal-on-surface-variant)] hover:text-[var(--portal-primary)]"
      >
        <PortalIcon name="arrow_back" /> Le mie prenotazioni
      </Link>

      {justCreated && (
        <PortalCard accent="secondary" className="mb-4">
          <div className="flex items-start gap-3">
            <PortalIcon
              name="check_circle"
              className="text-3xl text-[var(--portal-secondary)]"
              filled
            />
            <div>
              <div className="portal-h3">
                {booking.status === BookingStatus.RESERVED
                  ? "Prenotazione confermata!"
                  : "Richiesta inviata!"}
              </div>
              <p className="mt-1 text-sm text-[var(--portal-on-surface-variant)]">
                {booking.status === BookingStatus.RESERVED
                  ? "Il tuo strumento è stato riservato. Ricordati di passare a ritirarlo nel periodo concordato."
                  : "Riceverai una mail non appena la richiesta sarà esaminata."}
              </p>
            </div>
          </div>
        </PortalCard>
      )}

      <div className="mb-3 flex items-center gap-2">
        <PortalChip tone={STATUS_TONE[booking.status]}>
          {STATUS_LABEL[booking.status]}
        </PortalChip>
        <span className="text-sm text-[var(--portal-on-surface-variant)]">
          ID: {booking.id}
        </span>
      </div>

      <h1 className="portal-h2 mb-4">{asset?.title ?? booking.name}</h1>

      {asset && (
        <PortalCard className="mb-4">
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
                <p className="mt-2 line-clamp-2 text-sm text-[var(--portal-on-surface-variant)]">
                  {asset.description}
                </p>
              )}
            </div>
          </div>
        </PortalCard>
      )}

      <PortalCard className="mb-4">
        <h2 className="portal-h3 mb-3">Periodo</h2>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="portal-label text-[var(--portal-on-surface-variant)]">
              Inizio
            </dt>
            <dd className="mt-1 font-semibold">{formatDate(booking.from)}</dd>
          </div>
          <div>
            <dt className="portal-label text-[var(--portal-on-surface-variant)]">
              Fine
            </dt>
            <dd className="mt-1 font-semibold">{formatDate(booking.to)}</dd>
          </div>
        </dl>
      </PortalCard>

      {booking.description && (
        <PortalCard className="mb-4">
          <h2 className="portal-h3 mb-2">Le tue note</h2>
          <p className="whitespace-pre-line text-sm text-[var(--portal-on-surface-variant)]">
            {booking.description}
          </p>
        </PortalCard>
      )}

      {booking.status === BookingStatus.CANCELLED &&
        booking.cancellationReason && (
          <PortalCard className="mb-4">
            <h2 className="portal-h3 mb-2 text-[var(--portal-error)]">
              Motivo del rifiuto
            </h2>
            <p className="text-sm text-[var(--portal-on-surface-variant)]">
              {booking.cancellationReason}
            </p>
          </PortalCard>
        )}

      {canCancel && (
        <Form method="post" className="mt-6">
          <input type="hidden" name="intent" value="cancel" />
          <PortalButton
            type="submit"
            variant="secondary"
            disabled={submitting}
            className="w-full"
          >
            {submitting ? "Annullamento…" : "Annulla prenotazione"}
          </PortalButton>
        </Form>
      )}
    </section>
  );
}
