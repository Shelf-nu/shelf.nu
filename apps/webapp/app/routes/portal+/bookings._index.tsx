import { BookingStatus } from "@prisma/client";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, NavLink, useLoaderData } from "react-router";
import { PortalLinkButton } from "~/components/portal/portal-button";
import { PortalCard } from "~/components/portal/portal-card";
import { PortalChip } from "~/components/portal/portal-chip";
import { PortalIcon } from "~/components/portal/portal-icon";
import { db } from "~/database/db.server";
import { requirePortalUser } from "~/modules/portal/portal.server";
import { STATUS_LABEL, STATUS_TONE } from "~/modules/portal/portal.shared";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export const meta: MetaFunction = () => [
  { title: appendToMetaTitle("Le mie prenotazioni") },
];

type Tab = "in-attesa" | "approvata" | "rifiutata" | "completata";

const TAB_TO_STATUSES: Record<Tab, BookingStatus[]> = {
  "in-attesa": [BookingStatus.DRAFT],
  approvata: [
    BookingStatus.RESERVED,
    BookingStatus.ONGOING,
    BookingStatus.OVERDUE,
  ],
  rifiutata: [BookingStatus.CANCELLED],
  completata: [BookingStatus.COMPLETE, BookingStatus.ARCHIVED],
};

const TAB_LABEL: Record<Tab, string> = {
  "in-attesa": "In attesa",
  approvata: "Approvata",
  rifiutata: "Rifiutata",
  completata: "Completata",
};

export async function loader({ context, request }: LoaderFunctionArgs) {
  const user = await requirePortalUser(context, request);
  const url = new URL(request.url);
  const tab = (url.searchParams.get("tab") as Tab) || "in-attesa";
  const statuses = TAB_TO_STATUSES[tab] ?? TAB_TO_STATUSES["in-attesa"];

  const bookings = await db.booking.findMany({
    where: {
      creatorId: user.id,
      organizationId: user.organizationId,
      status: { in: statuses },
    },
    select: {
      id: true,
      name: true,
      status: true,
      from: true,
      to: true,
      assets: {
        select: {
          id: true,
          title: true,
          thumbnailImage: true,
          mainImage: true,
        },
        take: 1,
      },
    },
    orderBy: [{ from: "desc" }],
    take: 50,
  });

  // Counts per tab so badges show
  const counts = await db.booking.groupBy({
    by: ["status"],
    where: {
      creatorId: user.id,
      organizationId: user.organizationId,
    },
    _count: { _all: true },
  });
  const tabCounts: Record<Tab, number> = {
    "in-attesa": 0,
    approvata: 0,
    rifiutata: 0,
    completata: 0,
  };
  for (const c of counts) {
    for (const [k, v] of Object.entries(TAB_TO_STATUSES) as [
      Tab,
      BookingStatus[],
    ][]) {
      if (v.includes(c.status)) tabCounts[k] += c._count._all;
    }
  }

  return { user, tab, bookings, tabCounts };
}

export default function PortalBookings() {
  const { user, tab, bookings, tabCounts } = useLoaderData<typeof loader>();
  const displayName =
    [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;

  return (
    <section className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="portal-h2">Ciao, {displayName}</h1>
      <p className="mb-6 text-[var(--portal-on-surface-variant)]">
        Gestisci le tue prenotazioni e lo stato dei tuoi asset.
      </p>

      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4">
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
          <NavLink
            key={t}
            to={`?tab=${t}`}
            className={() => {
              const isActive = t === tab;
              return `shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-full text-sm font-semibold border transition-colors ${
                isActive
                  ? "bg-[var(--portal-primary)] text-[var(--portal-on-primary)] border-[var(--portal-primary)]"
                  : "bg-[var(--portal-surface-container-lowest)] text-[var(--portal-on-surface)] border-[var(--portal-outline-variant)]"
              }`;
            }}
          >
            {TAB_LABEL[t]}
            {tabCounts[t] > 0 && (
              <span className="text-xs opacity-80">({tabCounts[t]})</span>
            )}
          </NavLink>
        ))}
      </div>

      {bookings.length === 0 ? (
        <PortalCard className="text-center text-[var(--portal-on-surface-variant)]">
          <p className="mb-3">Nessuna prenotazione in questa categoria.</p>
          <PortalLinkButton to="/portal/catalog" variant="secondary">
            Sfoglia il catalogo
          </PortalLinkButton>
        </PortalCard>
      ) : (
        <div className="space-y-3">
          {bookings.map((b) => (
            <Link
              key={b.id}
              to={`/portal/bookings/${b.id}`}
              className="group block"
            >
              <PortalCard className="flex gap-3 p-3 transition-shadow hover:shadow-md">
                <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[var(--portal-surface-container)]">
                  {b.assets[0]?.thumbnailImage || b.assets[0]?.mainImage ? (
                    <img
                      src={
                        b.assets[0]?.thumbnailImage ??
                        b.assets[0]?.mainImage ??
                        undefined
                      }
                      alt={b.assets[0]?.title ?? ""}
                      className="size-full object-cover"
                    />
                  ) : (
                    <PortalIcon
                      name="construction"
                      className="text-2xl text-[var(--portal-outline)]"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <PortalChip tone={STATUS_TONE[b.status]}>
                      {STATUS_LABEL[b.status]}
                    </PortalChip>
                  </div>
                  <h3 className="truncate font-semibold">
                    {b.assets[0]?.title ?? b.name}
                  </h3>
                  <p className="text-sm text-[var(--portal-on-surface-variant)]">
                    {new Date(b.from).toLocaleDateString("it-IT", {
                      dateStyle: "medium",
                    })}{" "}
                    →{" "}
                    {new Date(b.to).toLocaleDateString("it-IT", {
                      dateStyle: "medium",
                    })}
                  </p>
                </div>
                <PortalIcon
                  name="chevron_right"
                  className="self-center text-[var(--portal-outline)]"
                />
              </PortalCard>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
