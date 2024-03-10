import type { LinksFunction } from "@remix-run/node";
import { Outlet } from "@remix-run/react";
import { ErrorBoundryComponent } from "~/components/errors";
import { useCrisp } from "~/components/marketing/crisp";
import styles from "~/styles/layout/index.css";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: styles }];

export default function App() {
  useCrisp();

  return (
    <div className="flex h-full min-h-screen flex-col ">
      <main className="relative flex size-full">
        <div className="flex size-full flex-col items-center justify-center md:p-20">
          <div className="size-full rounded-xl bg-white shadow-xl">
            <Outlet />
          </div>
        </div>
        <img
          src="/images/bg-overlay1.png"
          alt="bg-overlay"
          className="absolute right-0 top-0 -z-10 size-full object-cover"
        />
      </main>
    </div>
  );
}

export const ErrorBoundary = () => (
  <ErrorBoundryComponent title="Sorry, page you are looking for doesn't exist" />
);
