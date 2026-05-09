import type { MetaFunction } from "react-router";
import { Link } from "react-router";
import { PortalLinkButton } from "~/components/portal/portal-button";
import { PortalCard } from "~/components/portal/portal-card";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export const meta: MetaFunction = () => [
  { title: appendToMetaTitle("Accesso negato") },
];

export default function PortalNoAccess() {
  return (
    <section className="flex min-h-[80vh] items-center justify-center px-4 py-10">
      <PortalCard className="w-full max-w-md text-center">
        <h1 className="portal-h2 mb-3">Account non abilitato</h1>
        <p className="mb-6 text-[var(--portal-on-surface-variant)]">
          Il tuo account non è ancora associato all&apos;Attrezzoteca. Esegui
          l&apos;accesso con un account abilitato oppure registrati per
          richiedere l&apos;ammissione.
        </p>
        <div className="flex flex-col gap-3">
          <PortalLinkButton to="/portal/login">Accedi</PortalLinkButton>
          <Link
            to="/portal/join"
            className="font-semibold text-[var(--portal-primary)]"
          >
            Crea un account
          </Link>
        </div>
      </PortalCard>
    </section>
  );
}
