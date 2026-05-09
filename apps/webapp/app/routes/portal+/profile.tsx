import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Form, useLoaderData } from "react-router";
import { PortalButton } from "~/components/portal/portal-button";
import { PortalCard } from "~/components/portal/portal-card";
import { PortalChip } from "~/components/portal/portal-chip";
import { requirePortalUser } from "~/modules/portal/portal.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export const meta: MetaFunction = () => [
  { title: appendToMetaTitle("Profilo") },
];

export async function loader({ context, request }: LoaderFunctionArgs) {
  const user = await requirePortalUser(context, request);
  return { user };
}

export default function PortalProfile() {
  const { user } = useLoaderData<typeof loader>();
  const displayName =
    [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;

  return (
    <section className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="portal-h2 mb-6">Il mio profilo</h1>
      <PortalCard>
        <div className="flex flex-col gap-3">
          <div>
            <div className="portal-label mb-1 text-[var(--portal-on-surface-variant)]">
              Nome
            </div>
            <div className="text-base">{displayName}</div>
          </div>
          <div>
            <div className="portal-label mb-1 text-[var(--portal-on-surface-variant)]">
              Email
            </div>
            <div className="break-all text-base">{user.email}</div>
          </div>
          <div>
            <div className="portal-label mb-1 text-[var(--portal-on-surface-variant)]">
              Stato account
            </div>
            <PortalChip tone={user.canSelfCheckout ? "success" : "warning"}>
              {user.canSelfCheckout
                ? "Prenotazioni automatiche"
                : "Richiede approvazione"}
            </PortalChip>
          </div>
        </div>
      </PortalCard>

      <Form method="post" action="/portal/logout" className="mt-6">
        <PortalButton type="submit" variant="secondary" className="w-full">
          Esci dall&apos;account
        </PortalButton>
      </Form>
    </section>
  );
}
