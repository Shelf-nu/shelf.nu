import { json, type LoaderArgs } from "@remix-run/node";
import { Outlet } from "@remix-run/react";

export default function QR() {
  return (
    <div>
      <Outlet />
    </div>
  );
}
