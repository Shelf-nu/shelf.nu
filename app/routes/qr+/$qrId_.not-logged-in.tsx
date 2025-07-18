import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { z } from "zod";
import { CuboidIcon } from "~/components/icons/library";
import { Button } from "~/components/shared/button";
import { useSearchParams } from "~/hooks/search-params";
import { usePosition } from "~/hooks/use-position";
import { data, getParams } from "~/utils/http.server";

export function loader({ params }: LoaderFunctionArgs) {
  const { qrId } = getParams(params, z.object({ qrId: z.string() }));

  return json(data({ qrId }));
}

export default function QrNotLoggedIn() {
  const [searchParams] = useSearchParams();
  const { qrId } = useLoaderData<typeof loader>();
  usePosition();

  return (
    <>
      <div className="flex flex-1 justify-center py-8">
        <div className="my-auto">
          <div className="mb-4 inline-flex items-center justify-center rounded-full border-8 border-solid border-primary-50 bg-primary-100 p-2 text-primary">
            <CuboidIcon />
          </div>
          <div className="mb-8">
            <h1 className="mb-2 text-[24px] font-semibold">
              Thank you for scanning
            </h1>
            <p className="text-color-600">
              Log in if you own this item. Contact the owner to report it found
              if it's lost.
            </p>
          </div>
          <div className="flex flex-col">
            <Button
              variant="primary"
              className="mb-4 max-w-full"
              to={encodeURI(
                `/login?redirectTo=${searchParams.get("redirectTo")}`
              )}
            >
              Log In
            </Button>
            <Button
              variant="secondary"
              to={`/qr/${qrId}/contact-owner`}
              className="max-w-full"
            >
              Contact Owner
            </Button>
          </div>
        </div>
      </div>
      <div className="mt-6 text-center text-sm text-color-500">
        Don't have an account?{" "}
        <Button
          variant="link"
          data-test-id="signupButton"
          to={encodeURI(`/join?redirectTo=${searchParams.get("redirectTo")}`)}
        >
          Sign up
        </Button>
      </div>
    </>
  );
}
