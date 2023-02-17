import { Outlet } from "@remix-run/react";

export default function ItemsPage() {
  return (
    <div className="flex h-full min-h-screen flex-col">
      <Outlet />
    </div>
  );
}
