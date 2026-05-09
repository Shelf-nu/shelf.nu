import type {
  LinksFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { Link, NavLink, Outlet, useLoaderData } from "react-router";
import { ErrorContent } from "~/components/errors";
import { PortalIcon } from "~/components/portal/portal-icon";
import { db } from "~/database/db.server";
import portalStyles from "~/styles/portal.css?url";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: portalStyles },
];

export const meta: MetaFunction = () => [
  { title: appendToMetaTitle("L'Attrezzoteca") },
];

export type PortalLayoutData = {
  user: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string;
    profilePicture: string | null;
  } | null;
};

export async function loader({ context }: LoaderFunctionArgs) {
  // Layout never gates; individual routes call requirePortalUser() when needed.
  if (!context.isAuthenticated) {
    return { user: null } satisfies PortalLayoutData;
  }
  const { userId } = context.getSession();
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      profilePicture: true,
    },
  });
  return { user } satisfies PortalLayoutData;
}

export default function PortalLayout() {
  const { user } = useLoaderData<typeof loader>();

  return (
    <div className="portal-theme min-h-dvh">
      <PortalTopBar user={user} />
      <main className="portal-page pb-24 pt-16 md:pb-0">
        <Outlet />
      </main>
      <PortalBottomNav />
      <PortalFooter />
    </div>
  );
}

function PortalTopBar({ user }: { user: PortalLayoutData["user"] }) {
  return (
    <header className="fixed left-0 top-0 z-40 flex h-16 w-full items-center justify-between border-b border-[var(--portal-outline-variant)] bg-[var(--portal-surface)] px-4">
      <Link
        to="/portal"
        className="portal-h2 text-[var(--portal-primary)]"
        style={{ fontFamily: '"Ronzino", system-ui, sans-serif' }}
      >
        LUMA
      </Link>
      <div className="flex items-center gap-2">
        {user ? (
          <Link
            to="/portal/profile"
            className="flex items-center gap-2"
            aria-label="Profilo"
          >
            <span className="hidden text-sm text-[var(--portal-on-surface-variant)] sm:block">
              {user.firstName ?? user.email}
            </span>
            <PortalIcon name="account_circle" className="text-3xl" />
          </Link>
        ) : (
          <Link
            to="/portal/login"
            className="text-sm font-semibold text-[var(--portal-primary)]"
          >
            Accedi
          </Link>
        )}
      </div>
    </header>
  );
}

function PortalBottomNav() {
  return (
    <nav
      className="fixed bottom-0 left-0 z-40 flex w-full items-center justify-around rounded-t-xl border-t border-[var(--portal-outline-variant)] bg-[var(--portal-surface)] p-2 shadow-lg md:hidden"
      aria-label="Navigazione"
    >
      <BottomNavLink to="/portal" glyph="e" label="Home" end />
      <BottomNavLink to="/portal/catalog" glyph="q" label="Catalogo" />
      <BottomNavLink
        to="/portal/bookings"
        glyph="u"
        label="Prenotazioni"
      />
      <BottomNavLink to="/portal/profile" glyph="d" label="Profilo" />
    </nav>
  );
}

function BottomNavLink({
  to,
  glyph,
  label,
  end,
}: {
  to: string;
  /** Single character rendered in the Qsci display font as the icon glyph. */
  glyph: string;
  label: string;
  /** Exact match — needed for /portal so it doesn't stay active on sub-routes. */
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex flex-col items-center justify-center gap-0.5 px-3 py-1 rounded-full transition-colors ${
          isActive
            ? "bg-[var(--portal-primary)] text-[var(--portal-on-primary)]"
            : "text-[var(--portal-on-surface-variant)]"
        }`
      }
    >
      <span
        aria-hidden="true"
        className="text-2xl leading-none"
        style={{ fontFamily: '"Qsci", system-ui, sans-serif' }}
      >
        {glyph}
      </span>
      <span className="text-[10px] font-semibold tracking-wide">{label}</span>
    </NavLink>
  );
}

function PortalFooter() {
  return (
    <footer className="hidden w-full flex-col items-center gap-3 border-t border-[var(--portal-outline-variant)] bg-[var(--portal-surface-container-highest)] px-4 py-8 md:flex">
      <div className="portal-h3 text-[var(--portal-primary)]">
        L&apos;Attrezzoteca
      </div>
      <p className="text-center text-sm text-[var(--portal-on-surface-variant)] opacity-80">
        © {new Date().getFullYear()} L&apos;Attrezzoteca · FabLab Val di
        Fiastra
      </p>
    </footer>
  );
}

export const ErrorBoundary = () => <ErrorContent />;
