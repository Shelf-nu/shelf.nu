import { Outlet } from "@remix-run/react";

import type { User } from "~/database";
import Sidebar from "./sidebar";

interface Props {
  user: User;
}

export default function LoggedInLayout({ user }: Props) {
  return (
    <div className="flex h-full min-h-screen flex-col">
      <main className="flex h-full bg-white">
        <div className="h-full w-80 border-r  bg-slate-800 p-8">
          <Sidebar user={user} />
        </div>

        <div className="flex-1">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
