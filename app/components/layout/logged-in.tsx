import { Outlet } from "@remix-run/react";

import Header from "./header";
import Sidebar from "./sidebar";

interface Props {
  email?: string;
}

export default function LoggedInLayout({ email }: Props) {
  return (
    <div className="flex h-full min-h-screen flex-col">
      <Header email={email} />

      <main className="flex h-full bg-white">
        <div className="h-full w-80 border-r bg-gray-50">
          <Sidebar />
        </div>

        <div className="flex-1">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
