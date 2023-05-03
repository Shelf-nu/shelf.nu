import { Link, useSearchParams } from "@remix-run/react";

export default function QrNotLoggedIn() {
  const [searchParams] = useSearchParams();
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
    </div>
  );
}
