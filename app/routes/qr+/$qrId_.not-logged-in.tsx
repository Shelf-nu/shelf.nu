import type { LoaderArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData, useSearchParams } from "@remix-run/react";

export const loader = ({ params }: LoaderArgs) => {
  const qrId = params.qrId as string;
  return json({ qrId });
};

export default function QrNotLoggedIn() {
  const [searchParams] = useSearchParams();
  const { qrId } = useLoaderData<typeof loader>();
  return (
    <div>
      <h1>Thank you for Scanning</h1>
      <p>
        Log in if you own this item. Contact the owner to report it found if
        it's lost.
      </p>
      <Link
        to={encodeURI(`/login?redirectTo=${searchParams.get("redirectTo")}`)}
      >
        Login
      </Link>
      <br />
      <Link to={`/qr/${qrId}/contact-owner`}>Report found</Link>
    </div>
  );
}
