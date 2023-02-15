import { LoaderArgs, json, redirect } from "@remix-run/node";
import { Outlet } from "@remix-run/react";
import { useTranslation } from "react-i18next";
import { i18nextServer } from "~/integrations/i18n";
import { getAuthSession } from "~/modules/auth";

export async function loader({ request }: LoaderArgs) {
  const authSession = await getAuthSession(request);
  const t = await i18nextServer.getFixedT(request, "auth");
  const title = t("login.title");

  if (authSession) return redirect("/items");

  return json({ title });
}

export default function Index() {
  const { t } = useTranslation(["common", "auth"]);
  return (
    <main className="relative flex min-h-screen items-center px-10">
      <div className="grid h-full grid-cols-2 gap-4">
        <div className="">
          <img
            src="/images/midJourney_shelf.png"
            alt="MidJourney generated shelf image"
            className="h-full"
          />
        </div>
        <div className="flex flex-col justify-center text-center">
          <h1>Shelf.nu</h1>

          <h2 className="mb-4">Login</h2>
          <Outlet />
        </div>
      </div>
    </main>
  );
}
