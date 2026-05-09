import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Form, Link, useLoaderData } from "react-router";
import { PortalCard } from "~/components/portal/portal-card";
import { PortalChip } from "~/components/portal/portal-chip";
import { PortalIcon } from "~/components/portal/portal-icon";
import { db } from "~/database/db.server";
import { useSearchParams } from "~/hooks/search-params";
import { resolvePortalOrgId } from "~/modules/portal/portal.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export const meta: MetaFunction = () => [
  { title: appendToMetaTitle("Catalogo") },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const orgId = await resolvePortalOrgId();
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const categoryId = (url.searchParams.get("category") ?? "").trim();

  const [assets, categories] = await Promise.all([
    db.asset.findMany({
      where: {
        organizationId: orgId,
        availableToBook: true,
        ...(q
          ? {
              OR: [
                { title: { contains: q, mode: "insensitive" } },
                { description: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
        ...(categoryId ? { categoryId } : {}),
      },
      select: {
        id: true,
        title: true,
        description: true,
        thumbnailImage: true,
        mainImage: true,
        status: true,
        category: { select: { id: true, name: true, color: true } },
        location: { select: { id: true, name: true } },
      },
      orderBy: [{ category: { name: "asc" } }, { title: "asc" }],
      take: 100,
    }),
    db.category.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return { assets, categories, q, categoryId };
}

export default function PortalCatalog() {
  const { assets, categories, q, categoryId } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();

  return (
    <section className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="portal-h2">Catalogo</h1>
          <p className="text-sm text-[var(--portal-on-surface-variant)]">
            Strumenti e postazioni disponibili.
          </p>
        </div>
      </div>

      <Form method="get" className="mb-4">
        <div className="relative">
          <PortalIcon
            name="search"
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--portal-outline)]"
          />
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Cerca strumenti o postazioni…"
            className="w-full py-3 pl-14 pr-4"
          />
          {categoryId && (
            <input type="hidden" name="category" value={categoryId} />
          )}
        </div>
      </Form>

      {/* Category chip row */}
      {categories.length > 0 && (
        <div className="-mx-4 mb-6 flex gap-2 overflow-x-auto px-4 pb-2">
          <CategoryChip
            label="Tutti"
            active={!categoryId}
            href={buildHref(searchParams, { category: null })}
          />
          {categories.map((c) => (
            <CategoryChip
              key={c.id}
              label={c.name}
              active={categoryId === c.id}
              href={buildHref(searchParams, { category: c.id })}
            />
          ))}
        </div>
      )}

      {assets.length === 0 ? (
        <PortalCard className="text-center text-[var(--portal-on-surface-variant)]">
          Nessuno strumento corrisponde alla ricerca.
        </PortalCard>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {assets.map((a) => (
            <Link key={a.id} to={`/portal/catalog/${a.id}`} className="group">
              <PortalCard className="flex gap-3 p-3 transition-shadow hover:shadow-md">
                <AssetThumb
                  src={a.thumbnailImage ?? a.mainImage}
                  alt={a.title}
                />
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    {a.category && (
                      <PortalChip tone="secondary">
                        {a.category.name}
                      </PortalChip>
                    )}
                    {a.status === "AVAILABLE" ? (
                      <PortalChip tone="success">Disponibile</PortalChip>
                    ) : (
                      <PortalChip tone="error">In uso</PortalChip>
                    )}
                  </div>
                  <h3 className="portal-h3 truncate">{a.title}</h3>
                  {a.location && (
                    <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-[var(--portal-on-surface-variant)]">
                      <PortalIcon name="location_on" className="text-sm" />
                      {a.location.name}
                    </p>
                  )}
                  {a.description && (
                    <p className="mt-1 line-clamp-2 text-sm text-[var(--portal-on-surface-variant)]">
                      {a.description}
                    </p>
                  )}
                  <div className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-[var(--portal-primary)] transition-transform group-hover:translate-x-1">
                    Dettagli <PortalIcon name="chevron_right" />
                  </div>
                </div>
              </PortalCard>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function CategoryChip({
  label,
  active,
  href,
}: {
  label: string;
  active: boolean;
  href: string;
}) {
  return (
    <Link
      to={href}
      className={`inline-flex shrink-0 items-center rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${
        active
          ? "border-[var(--portal-primary)] bg-[var(--portal-primary)] text-[var(--portal-on-primary)]"
          : "border-[var(--portal-outline-variant)] bg-[var(--portal-surface-container-lowest)] text-[var(--portal-on-surface)] hover:bg-[var(--portal-surface-container-low)]"
      }`}
    >
      {label}
    </Link>
  );
}

function AssetThumb({
  src,
  alt,
}: {
  src: string | null | undefined;
  alt: string;
}) {
  return (
    <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[var(--portal-surface-container)]">
      {src ? (
        <img src={src} alt={alt} className="size-full object-cover" />
      ) : (
        <PortalIcon
          name="construction"
          className="text-3xl text-[var(--portal-outline)]"
        />
      )}
    </div>
  );
}

function buildHref(
  current: URLSearchParams,
  patch: Record<string, string | null>
): string {
  const next = new URLSearchParams(current);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === "") next.delete(k);
    else next.set(k, v);
  }
  const qs = next.toString();
  return `/portal/catalog${qs ? `?${qs}` : ""}`;
}
