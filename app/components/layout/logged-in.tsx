import { Outlet } from "@remix-run/react";

import Sidebar from "./sidebar";

interface Props {
  email?: string;
}

export default function LoggedInLayout({ email }: Props) {
  return (
    <div className="flex h-full min-h-screen flex-col">
      <main className="flex h-full bg-white">
        <div className="h-full w-80 border-r  bg-slate-800 p-4">
          <Sidebar email={email} />
        </div>

        <div className="flex-1">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
