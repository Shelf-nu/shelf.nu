import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams } from "@remix-run/react";
import { CuboidIcon } from "~/components/icons";
import { Button } from "~/components/shared";
import { usePosition } from "~/hooks";

export const loader = ({ params }: LoaderFunctionArgs) => {
  const qrId = params.qrId as string;
  return json({ qrId });
};

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
              Thank you for Scanning
            </h1>
            <p className="text-gray-600">
              Log in if you own this asset. Contact the owner to report it found
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
      <div className="mt-6 text-center text-sm text-gray-500">
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
