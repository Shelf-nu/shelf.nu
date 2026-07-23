import type { LoaderFunctionArgs } from "react-router";
import { data, Link, Outlet } from "react-router";
import { ErrorContent } from "~/components/errors";

import HorizontalTabs from "~/components/layout/horizontal-tabs";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError } from "~/utils/error";
import { payload, error } from "~/utils/http.server";
import { requireAdmin } from "~/utils/roles.server";

export async function loader({ context }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    await requireAdmin(userId);

    return payload(null);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

export const meta = () => [{ title: appendToMetaTitle("Painel do Administrador") }];

export const handle = {
  breadcrumb: () => <Link to="/admin-dashboard">Admin dashboard</Link>,
};

const items = [
  {
    to: "users",
    content: "Usuários",
    isActive: (pathname: string) =>
      pathname.includes("admin-dashboard") &&
      (pathname.includes("users") ||
        pathname.includes("members") ||
        pathname.includes("assets") ||
        pathname.includes("qr-codes")),
  },
  { to: "qrs", content: "Códigos QR" },
  { to: "announcements", content: "Comunicados" },
  { to: "updates", content: "Atualizações" },
  { to: "move-location-images", content: "Mover imagens de locais" },
  { to: "generate-locations", content: "Gerar locais" },
  { to: "test-supabase-rls", content: "Testar Supabase RLS" },
];

export default function Area51Page() {
  return (
    <div>
      <HorizontalTabs items={items} />
      <div>
        <Outlet />
      </div>
    </div>
  );
}

export const ErrorBoundary = () => <ErrorContent />;
