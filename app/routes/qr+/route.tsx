import { Outlet } from "@remix-run/react";

export default function QR() {
  return (
    <div>
      I am the layout that all other routes in the qr+ namespace will use. Use
      me to make the general page layout. Outlet is where the child content is
      rendered.
      <Outlet />
    </div>
  );
}
