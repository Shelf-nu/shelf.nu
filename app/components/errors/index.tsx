import {
  Links,
  LiveReload,
  Meta,
  Scripts,
  ScrollRestoration,
} from "@remix-run/react";
import { ErrorContent } from "./content";

export interface ErrorContentProps {
  title?: string;
  message?: string | JSX.Element;
}

export const ErrorBoundryComponent = () => (
  <html lang="en" className="h-full">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <Meta />
      <Links />
    </head>
    <body className="h-full">
      <ErrorContent />
      <ScrollRestoration />
      <Scripts />
      <LiveReload />
    </body>
  </html>
);
