import { json, redirect, type LoaderArgs } from "@remix-run/node";
import { isRouteErrorResponse, useRouteError } from "@remix-run/react";
import { requireAuthSession } from "~/modules/auth";
import { getQr } from "~/modules/qr";
import { notFound } from "~/utils";

export const loader = async ({ request, params }: LoaderArgs) => {
  /* Get the ID of the QR from the params */
  const id = params.qrId as string;

  /* Find the QR in the database */
  const qr = await getQr(id);

  /** If the QR doesn't exist, return a 404
   *
   * AFTER MVP: Here we have to consider a delted User which will
   * delete all the connected QRs.
   * However, in real life there could be a physical QR code
   * that is still there. Will we allow someone to claim it?
   */
  if (!qr) {
    throw notFound("Not found");
  }

  /**
   * Check if user is logged in.
   *  - If not, redirect to the login page, which will automatically then redirect back to here so all checks are performed again
   *  - If so, continue
   */
  await requireAuthSession(request, {
    onFailRedirectTo: "../not-logged-in",
    verify: false,
  });

  /**
   * Does the QR code belong to any user.
   * SKIP FOR NOW, AFTER MVP: QR codes sold on amazon. These will be created manually somehow by us and have no
   * user assigned. We currently can't even do that because we have a unique constraint
   * on the userId within Qr in the database.
   */

  /**
   * Does the QR code belong to LOGGED IN user
   */

  // ...logic comes here

  return redirect(`/items/${qr.itemId}`);
};

/** 404 handling */
export function CatchBoundary() {
  const error = useRouteError();
  return isRouteErrorResponse(error) ? (
    <div className="mx-auto max-w-[300px] text-center">
      <h1>Code Not Found</h1>
      <p>
        This QR code is not found in our database. Make sure the code you are
        scanning is registered by a Shelf user.
      </p>
    </div>
  ) : null;
}

export default function Qr() {
  return (
    <div>
      <h1>Thank you for scanning</h1>
      <p>This is show page</p>
    </div>
  );
}
