import type { MetaFunction } from "react-router";
import { Form } from "react-router";
import { PortalLinkButton } from "~/components/portal/portal-button";
import { PortalCard } from "~/components/portal/portal-card";
import { PortalIcon } from "~/components/portal/portal-icon";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export const meta: MetaFunction = () => [
  { title: appendToMetaTitle("L'Attrezzoteca · Home") },
];

const FAQ = [
  {
    q: "Come posso prenotare uno strumento?",
    a: "Registrati al portale, naviga nel catalogo, scegli data e ora di ritiro e conferma la prenotazione. Riceverai una mail con tutti i dettagli.",
  },
  {
    q: "Quanto costa il servizio?",
    a: "Per gli strumenti di base il costo è simbolico. Per i macchinari specialistici, il prezzo è indicato sulla scheda dello strumento.",
  },
  {
    q: "Posso usare gli strumenti in sede?",
    a: "Sì — alcune attrezzature, come la stampante 3D o il laser CO2, si usano direttamente in officina prenotando una postazione.",
  },
];

export default function PortalIndex() {
  return (
    <>
      {/* Hero */}
      <section className="relative flex min-h-[480px] flex-col items-center justify-center overflow-hidden px-4 py-12 text-center">
        <div className="relative z-10 w-full max-w-2xl">
          <h1 className="portal-h1 mb-3 text-[var(--portal-primary)]">
            L&apos;Attrezzoteca
          </h1>
          <p className="mb-8 text-lg text-[var(--portal-on-surface-variant)]">
            Il tuo inventario condiviso di strumenti professionali per dare vita
            a ogni progetto.
          </p>
          <Form
            method="get"
            action="/portal/catalog"
            className="mb-4 flex w-full flex-col gap-2 md:flex-row"
          >
            <div className="relative grow">
              <PortalIcon
                name="search"
                className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--portal-outline)]"
              />
              <input
                type="search"
                name="q"
                className="w-full py-4 pl-12 pr-4"
                placeholder="Cerca uno strumento (es. Trapano, Stampante 3D...)"
              />
            </div>
            <button
              type="submit"
              className="rounded-lg bg-[var(--portal-primary)] px-6 py-4 font-semibold text-[var(--portal-on-primary)] transition-transform active:scale-95"
            >
              Cerca
            </button>
          </Form>
        </div>
      </section>

      {/* Cards */}
      <section className="bg-[var(--portal-surface-container-low)] px-4 py-12">
        <div className="mx-auto max-w-5xl">
          <h2 className="portal-h2 mb-8 text-center">Cosa puoi fare qui?</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <PortalCard
              accent="primary"
              className="transition-shadow hover:shadow-lg"
            >
              <div className="mb-3 flex items-start justify-between">
                <PortalIcon
                  name="handyman"
                  className="text-4xl text-[var(--portal-primary)]"
                />
                <span className="portal-label text-[var(--portal-on-surface-variant)]">
                  Attrezzatura
                </span>
              </div>
              <h3 className="portal-h3 mb-2">Prestito strumenti</h3>
              <p className="mb-4 text-[var(--portal-on-surface-variant)]">
                Accedi a un catalogo completo di elettroutensili e strumenti
                digitali da portare a casa o usare in sede.
              </p>
              <PortalLinkButton to="/portal/catalog" variant="ghost">
                Vedi catalogo
                <PortalIcon name="chevron_right" />
              </PortalLinkButton>
            </PortalCard>

            <PortalCard
              accent="secondary"
              className="transition-shadow hover:shadow-lg"
            >
              <div className="mb-3 flex items-start justify-between">
                <PortalIcon
                  name="event_available"
                  className="text-4xl text-[var(--portal-secondary)]"
                />
                <span className="portal-label text-[var(--portal-on-surface-variant)]">
                  Prenota
                </span>
              </div>
              <h3 className="portal-h3 mb-2">Le mie prenotazioni</h3>
              <p className="mb-4 text-[var(--portal-on-surface-variant)]">
                Gestisci le richieste in attesa, i prestiti attivi e lo storico
                delle prenotazioni completate.
              </p>
              <PortalLinkButton to="/portal/bookings" variant="ghost">
                Vai alle prenotazioni
                <PortalIcon name="chevron_right" />
              </PortalLinkButton>
            </PortalCard>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-3xl px-4 py-12">
        <h2 className="portal-h2 mb-8 text-center">Domande frequenti</h2>
        <div className="space-y-2">
          {FAQ.map((item) => (
            <details
              key={item.q}
              className="group overflow-hidden rounded-xl border border-[var(--portal-outline-variant)] bg-[var(--portal-surface)]"
            >
              <summary className="flex cursor-pointer items-center justify-between p-4 font-semibold transition-colors hover:bg-[var(--portal-surface-container-low)]">
                {item.q}
                <PortalIcon name="expand_more" className="portal-chevron" />
              </summary>
              <div className="border-t border-[var(--portal-outline-variant)] bg-[var(--portal-surface-container-lowest)] p-4 text-[var(--portal-on-surface-variant)]">
                {item.a}
              </div>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}
