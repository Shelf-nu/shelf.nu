import { Link, Outlet } from "@remix-run/react";
import { ErrorContent } from "~/components/errors";
import { ShelfFullLogo } from "~/components/marketing/logos";
import { usePosition } from "~/hooks/use-position";

export default function QR() {
  usePosition();
  return (
    <div className="container h-full min-h-screen px-4 py-12">
      <div className="flex h-full flex-col justify-center text-center">
        <Link
          to="/assets"
          title="Home"
          className="logo mx-auto inline-block h-[32px]"
        >
          <ShelfFullLogo className="h-full" />
        </Link>

        <Outlet />
      </div>
    </div>
  );
}

export const ErrorBoundary = () => <ErrorContent />;
