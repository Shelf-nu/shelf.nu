import * as React from "react";

import type { LoaderArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Outlet, useLoaderData } from "@remix-run/react";

import { getAuthSession } from "~/modules/auth";

export async function loader({ request }: LoaderArgs) {
  const authSession = await getAuthSession(request);
  const title = "Shelf.nu | Login";

  if (authSession) return redirect("/items");

  return json({ title });
}

export default function Index() {
  const data = useLoaderData<typeof loader>();
  return (
    <main className="relative flex min-h-screen items-center px-10">
      <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex">
          <img
            src="/images/cover.jpg"
            alt="MidJourney generated shelf"
            className="h-auto w-full object-contain"
          />
        </div>
        <div className="flex flex-col justify-center text-center">
          <h2 className="mb-4">{data.title}</h2>
          <Outlet />
        </div>
      </div>
    </main>
  );
}
