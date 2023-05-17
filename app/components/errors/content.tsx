import {
  Links,
  LiveReload,
  Meta,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useLocation,
} from "@remix-run/react";
import { NODE_ENV } from "~/utils/env";
import { Button } from "../shared";

export const ErrorContent = ({
  title,
  message,
  error,
}: {
  title: string;
  message: string;
  error?: unknown;
}) => (
  <html lang="en" className="h-full">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <Meta />
      {title ? <title>{title}</title> : null}
      <Links />
    </head>
    <body className="h-full">
      <InnerContent title={title} message={message} error={error} />
      <ScrollRestoration />
      <Scripts />
      <LiveReload />
    </body>
  </html>
);

const InnerContent = ({
  title,
  message,
  error,
}: {
  title: string;
  message: string;
  error?: unknown;
}) => {
  const location = useLocation();
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="flex flex-col items-center text-center">
        <img src="/images/error-icon.svg" alt={title} className="mb-5" />
        <h2 className="mb-2">{title}</h2>
        {NODE_ENV === "production"
          ? "A server error has occured. Try refreshing the page. If the issue persists please get in touch with support."
          : message}
        <div className=" mt-8 flex gap-3">
          <Button to="/" variant="secondary" icon="home">
            Back to home
          </Button>
          {isRouteErrorResponse(error) ? (
            <Button to={location.pathname} reloadDocument>
              Reload page
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
};
