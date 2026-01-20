import type { LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import { z } from "zod";
import { CuboidIcon } from "~/components/icons/library";
import { Button } from "~/components/shared/button";
import { db } from "~/database/db.server";
import { useSearchParams } from "~/hooks/search-params";
import { usePosition } from "~/hooks/use-position";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { ShelfError, makeShelfError } from "~/utils/error";
import { error, payload, getParams } from "~/utils/http.server";

export const meta = () => [{ title: appendToMetaTitle("QR not logged in") }];

export async function loader({ params }: LoaderFunctionArgs) {
  const { qrId } = getParams(params, z.object({ qrId: z.string() }));

  try {
    const qr = await db.qr.findUnique({
      where: { id: qrId },
      select: { organizationId: true },
    });

    if (!qr) {
      throw new ShelfError({
        cause: null,
        message: "This code doesn't exist.",
        title: "QR code not found",
        status: 404,
        additionalData: { qrId },
        label: "QR",
      });
    }

    return data(
      payload({ qrId, canContactOwner: Boolean(qr.organizationId) })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { qrId });
    throw data(error(reason), { status: reason.status });
  }
}

export default function QrNotLoggedIn() {
  const [searchParams] = useSearchParams();
  const { qrId, canContactOwner } = useLoaderData<typeof loader>();
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
            <p className="text-gray-600">
              {canContactOwner
                ? "Log in if you own this item. Contact the owner to report it found if it's lost."
                : "Log in if you own this item. This code hasn't been claimed yet."}
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
            {canContactOwner ? (
              <Button
                variant="secondary"
                to={`/qr/${qrId}/contact-owner`}
                className="max-w-full"
              >
                Contact Owner
              </Button>
            ) : null}
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
