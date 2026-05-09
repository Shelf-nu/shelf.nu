import { useMemo, useState } from "react";
import {
  addDays,
  addWeeks,
  endOfWeek,
  format,
  isToday,
  startOfWeek,
  subWeeks,
} from "date-fns";
import { it } from "date-fns/locale";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Form, Link, useLoaderData } from "react-router";
import { PortalButton } from "~/components/portal/portal-button";
import { PortalCard } from "~/components/portal/portal-card";
import { PortalChip } from "~/components/portal/portal-chip";
import { PortalIcon } from "~/components/portal/portal-icon";
import { db } from "~/database/db.server";
import { useSearchParams } from "~/hooks/search-params";
import { resolvePortalOrgId } from "~/modules/portal/portal.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { ShelfError } from "~/utils/error";

// Loader returns Date objects but Remix serializes to strings on the wire,
// so accept either form and normalize via `new Date(...)` at use sites.
type CalendarBooking = {
  from: Date | string;
  to: Date | string;
  status: string;
};

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  {
    title: appendToMetaTitle(
      data && "asset" in data ? data.asset.title : "Strumento"
    ),
  },
];

export async function loader({ params }: LoaderFunctionArgs) {
  const orgId = await resolvePortalOrgId();
  const assetId = params.assetId;
  if (!assetId) {
    throw new ShelfError({
      cause: null,
      message: "Asset id mancante",
      label: "Portal",
      status: 400,
    });
  }
  const asset = await db.asset.findFirst({
    where: { id: assetId, organizationId: orgId, availableToBook: true },
    select: {
      id: true,
      title: true,
      description: true,
      thumbnailImage: true,
      mainImage: true,
      status: true,
      category: { select: { id: true, name: true } },
      location: { select: { id: true, name: true, address: true } },
      tags: { select: { id: true, name: true } },
      bookings: {
        where: {
          status: { in: ["RESERVED", "ONGOING", "OVERDUE"] },
          to: { gt: new Date() },
        },
        select: { from: true, to: true, status: true },
        orderBy: { from: "asc" },
        take: 32,
      },
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

  return { asset };
}

export default function PortalAssetDetail() {
  const { asset } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();

  // Sensible default range: tomorrow 09:00 → tomorrow 18:00.
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const defaultFromDate =
    searchParams.get("from") ?? tomorrow.toISOString().slice(0, 10);
  const defaultToDate =
    searchParams.get("to") ?? tomorrow.toISOString().slice(0, 10);

  const [fromValue, setFromValue] = useState(`${defaultFromDate}T09:00`);
  const [toValue, setToValue] = useState(`${defaultToDate}T18:00`);

  // Date-aware overlap check against the bookings already loaded server-side.
  // Two intervals [a,b) and [c,d) overlap iff a < d AND c < b.
  const conflict = useMemo(() => {
    const from = new Date(fromValue);
    const to = new Date(toValue);
    if (
      Number.isNaN(from.getTime()) ||
      Number.isNaN(to.getTime()) ||
      to <= from
    ) {
      return null;
    }
    return (
      asset.bookings.find(
        (b) => from < new Date(b.to) && new Date(b.from) < to
      ) ?? null
    );
  }, [fromValue, toValue, asset.bookings]);

  const datesInvalid = (() => {
    const from = new Date(fromValue);
    const to = new Date(toValue);
    return (
      Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from
    );
  })();

  return (
    <section className="mx-auto max-w-3xl px-4 py-6">
      <Link
        to="/portal/catalog"
        className="mb-4 inline-flex items-center gap-1 text-sm text-[var(--portal-on-surface-variant)] hover:text-[var(--portal-primary)]"
      >
        <PortalIcon name="arrow_back" /> Torna al catalogo
      </Link>

      <div className="mb-4 flex aspect-video items-center justify-center overflow-hidden rounded-2xl bg-[var(--portal-surface-container)]">
        {asset.mainImage || asset.thumbnailImage ? (
          <img
            src={asset.mainImage ?? asset.thumbnailImage ?? undefined}
            alt={asset.title}
            className="size-full object-cover"
          />
        ) : (
          <PortalIcon
            name="construction"
            className="text-6xl text-[var(--portal-outline)]"
          />
        )}
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {asset.category && (
          <PortalChip tone="secondary">{asset.category.name}</PortalChip>
        )}
        {asset.location && (
          <PortalChip tone="neutral">
            <PortalIcon name="location_on" className="mr-1 text-sm" />
            {asset.location.name}
          </PortalChip>
        )}
      </div>

      <h1 className="portal-h1 mb-2">{asset.title}</h1>
      {asset.description && (
        <p className="mb-6 whitespace-pre-line text-[var(--portal-on-surface-variant)]">
          {asset.description}
        </p>
      )}

      {asset.tags.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {asset.tags.map((t) => (
            <PortalChip key={t.id} tone="neutral">
              #{t.name}
            </PortalChip>
          ))}
        </div>
      )}

      <PortalCard className="mb-4">
        <h2 className="portal-h3 mb-3">Scegli il periodo</h2>
        <Form
          method="get"
          action="/portal/bookings/new"
          className="flex flex-col gap-4"
        >
          <input type="hidden" name="assetId" value={asset.id} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="portal-label mb-1 block text-[var(--portal-on-surface-variant)]">
                Dal
              </span>
              <input
                type="datetime-local"
                name="from"
                value={fromValue}
                onChange={(e) => setFromValue(e.target.value)}
                required
                className="w-full"
              />
            </label>
            <label className="block">
              <span className="portal-label mb-1 block text-[var(--portal-on-surface-variant)]">
                Al
              </span>
              <input
                type="datetime-local"
                name="to"
                value={toValue}
                onChange={(e) => setToValue(e.target.value)}
                required
                className="w-full"
              />
            </label>
          </div>

          {/* Live availability indicator for the selected range. */}
          {datesInvalid ? (
            <div className="rounded-lg bg-[var(--portal-surface-container)] px-3 py-2 text-sm text-[var(--portal-on-surface-variant)]">
              Seleziona un intervallo di date valido.
            </div>
          ) : conflict ? (
            <div className="flex items-start gap-2 rounded-lg bg-[var(--portal-error-container)] px-3 py-2 text-sm text-[var(--portal-on-error-container)]">
              <PortalIcon name="event_busy" />
              <span>
                Non disponibile in questo periodo — già prenotato dal{" "}
                {new Date(conflict.from).toLocaleString("it-IT", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}{" "}
                al{" "}
                {new Date(conflict.to).toLocaleString("it-IT", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
                . Scegli un altro periodo.
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-lg bg-[color-mix(in_srgb,var(--portal-success)_15%,transparent)] px-3 py-2 text-sm text-[var(--portal-success)]">
              <PortalIcon name="event_available" />
              Disponibile per il periodo selezionato
            </div>
          )}

          <PortalButton
            type="submit"
            size="lg"
            disabled={datesInvalid || conflict !== null}
          >
            Continua
            <PortalIcon name="arrow_forward" />
          </PortalButton>
        </Form>
      </PortalCard>

      <PortalCard>
        <h2 className="portal-h3 mb-3">Calendario disponibilità</h2>
        <AvailabilityCalendar
          bookings={asset.bookings}
          fromValue={fromValue}
          toValue={toValue}
          onPickHour={(hourStart) => {
            // hourStart is the local Date representing the start of the
            // clicked 1-hour cell. We translate it into the "yyyy-MM-ddTHH:mm"
            // format that <input type="datetime-local"> expects.
            const slotIso = format(hourStart, "yyyy-MM-dd'T'HH:mm");
            const slotEndIso = format(
              new Date(hourStart.getTime() + 60 * 60 * 1000),
              "yyyy-MM-dd'T'HH:mm"
            );

            const currentFrom = new Date(fromValue);
            const currentTo = new Date(toValue);
            const validRange =
              !Number.isNaN(currentFrom.getTime()) &&
              !Number.isNaN(currentTo.getTime()) &&
              currentTo > currentFrom;
            const isFreshOneHourRange =
              validRange &&
              currentTo.getTime() - currentFrom.getTime() === 60 * 60 * 1000;

            if (isFreshOneHourRange && hourStart > currentFrom) {
              // Second click after a single-hour pick → extend the range up to
              // and including the clicked hour. End is exclusive (slot end).
              setToValue(slotEndIso);
            } else {
              // First click, click before current start, or click after a
              // multi-hour range → start a new 1-hour range.
              setFromValue(slotIso);
              setToValue(slotEndIso);
            }
          }}
        />
      </PortalCard>
    </section>
  );
}

// FabLab business hours — visible rows of the week grid. Bookings outside
// this window are still respected by the live conflict check above; they
// just aren't shown here.
const HOUR_START = 8;
const HOUR_END = 20; // exclusive (last visible row starts at 19:00)

function AvailabilityCalendar({
  bookings,
  fromValue,
  toValue,
  onPickHour,
}: {
  bookings: CalendarBooking[];
  fromValue: string;
  toValue: string;
  /** Called with the local Date representing the start of the clicked hour cell. */
  onPickHour: (hourStart: Date) => void;
}) {
  // viewWeekStart is always a Monday at 00:00.
  const [viewWeekStart, setViewWeekStart] = useState<Date>(() => {
    const fromDate = new Date(fromValue);
    const seed = Number.isNaN(fromDate.getTime()) ? new Date() : fromDate;
    return startOfWeek(seed, { weekStartsOn: 1 });
  });

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(viewWeekStart, i)),
    [viewWeekStart]
  );
  const hours = useMemo(
    () =>
      Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i),
    []
  );

  const selFrom = useMemo(() => {
    const d = new Date(fromValue);
    return Number.isNaN(d.getTime()) ? null : d;
  }, [fromValue]);
  const selTo = useMemo(() => {
    const d = new Date(toValue);
    return Number.isNaN(d.getTime()) ? null : d;
  }, [toValue]);

  const parsedBookings = useMemo(
    () =>
      bookings.map((b) => ({
        from: new Date(b.from),
        to: new Date(b.to),
      })),
    [bookings]
  );

  const now = new Date();

  return (
    <div>
      {/* Week navigation header */}
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setViewWeekStart((w) => subWeeks(w, 1))}
          className="rounded-full p-2 hover:bg-[var(--portal-surface-container)]"
          aria-label="Settimana precedente"
        >
          <PortalIcon name="chevron_left" />
        </button>
        <span className="text-sm font-semibold">
          {format(viewWeekStart, "d MMM", { locale: it })}
          {" – "}
          {format(endOfWeek(viewWeekStart, { weekStartsOn: 1 }), "d MMM yyyy", {
            locale: it,
          })}
        </span>
        <button
          type="button"
          onClick={() => setViewWeekStart((w) => addWeeks(w, 1))}
          className="rounded-full p-2 hover:bg-[var(--portal-surface-container)]"
          aria-label="Settimana successiva"
        >
          <PortalIcon name="chevron_right" />
        </button>
      </div>

      {/* Scrollable wrapper so narrow phones can scroll horizontally if needed. */}
      <div className="-mx-2 overflow-x-auto px-2">
        <div className="min-w-[480px]">
          {/* Day-of-week header row, aligned with the hour-label gutter on the left. */}
          <div
            className="mb-1 grid text-xs"
            style={{ gridTemplateColumns: "2.5rem repeat(7, minmax(0, 1fr))" }}
          >
            <div />
            {days.map((d) => {
              const today = isToday(d);
              return (
                <div
                  key={d.toISOString()}
                  className={`py-1 text-center ${
                    today
                      ? "font-bold text-[var(--portal-primary)]"
                      : "text-[var(--portal-on-surface-variant)]"
                  }`}
                >
                  <div className="uppercase">
                    {format(d, "EEE", { locale: it })}
                  </div>
                  <div className={today ? "text-base" : ""}>
                    {format(d, "d")}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Hour rows */}
          <div className="overflow-hidden rounded-lg border border-[var(--portal-outline-variant)]">
            {hours.map((hour, rowIdx) => (
              <div
                key={hour}
                className="grid"
                style={{
                  gridTemplateColumns: "2.5rem repeat(7, minmax(0, 1fr))",
                }}
              >
                <div
                  className={`flex items-start justify-end pr-1 pt-0.5 text-[10px] text-[var(--portal-on-surface-variant)] ${
                    rowIdx > 0
                      ? "border-t border-[var(--portal-outline-variant)]"
                      : ""
                  }`}
                >
                  {String(hour).padStart(2, "0")}:00
                </div>
                {days.map((d) => {
                  const cellStart = new Date(
                    d.getFullYear(),
                    d.getMonth(),
                    d.getDate(),
                    hour,
                    0,
                    0,
                    0
                  );
                  const cellEnd = new Date(
                    cellStart.getTime() + 60 * 60 * 1000
                  );
                  const isPast = cellEnd <= now;
                  const isBlocked = parsedBookings.some(
                    (b) => b.from < cellEnd && cellStart < b.to
                  );
                  const inSelected =
                    selFrom !== null &&
                    selTo !== null &&
                    cellStart < selTo &&
                    selFrom < cellEnd;
                  const isDisabled = isPast || isBlocked;

                  let cellClass =
                    "h-7 transition-colors border-l border-[var(--portal-outline-variant)] ";
                  if (rowIdx > 0) cellClass += "border-t ";
                  if (isPast) {
                    cellClass +=
                      "bg-[var(--portal-surface-container)] opacity-50 cursor-not-allowed ";
                  } else if (isBlocked) {
                    cellClass +=
                      "bg-[var(--portal-error-container)] cursor-not-allowed ";
                  } else if (inSelected) {
                    cellClass += "bg-[var(--portal-primary)] cursor-pointer ";
                  } else {
                    cellClass +=
                      "hover:bg-[color-mix(in_srgb,var(--portal-primary)_15%,transparent)] cursor-pointer ";
                  }

                  return (
                    <button
                      key={d.toISOString() + ":" + hour}
                      type="button"
                      disabled={isDisabled}
                      onClick={() => onPickHour(cellStart)}
                      className={cellClass}
                      title={
                        isBlocked
                          ? "Già prenotato"
                          : isPast
                          ? "Ora passata"
                          : format(cellStart, "EEEE d MMMM HH:mm", {
                              locale: it,
                            })
                      }
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--portal-on-surface-variant)]">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-3 rounded bg-[var(--portal-primary)]" />
          Selezionato
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-3 rounded bg-[var(--portal-error-container)]" />
          Non disponibile
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-3 rounded bg-[var(--portal-surface-container)] opacity-50" />
          Passato
        </span>
      </div>
      <p className="mt-2 text-xs text-[var(--portal-on-surface-variant)]">
        Tocca un&apos;ora per iniziare la prenotazione, poi un&apos;altra ora
        successiva per estendere la fine. Orario visualizzato:{" "}
        {String(HOUR_START).padStart(2, "0")}:00–
        {String(HOUR_END).padStart(2, "0")}:00.
      </p>
    </div>
  );
}
