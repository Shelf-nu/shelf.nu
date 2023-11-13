import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Outlet } from "@remix-run/react";
import Input from "~/components/forms/input";
import { Button } from "~/components/shared";
import { db } from "~/database";
import { requireAuthSession } from "~/modules/auth";
import { requireAdmin } from "~/utils/roles.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireAuthSession(request);
  await requireAdmin(request);

  // const announcements = await db.announcement.findMany({
  //   orderBy: {
  //     createdAt: "desc",
  //   },
  // });

  return json({});
};

export const action = async ({ request }: ActionFunctionArgs) => null;

export default function Announcements() {
  return (
    <div>
      <div className="flex justify-between">
        <h2>Announcements</h2>
        <Button variant="primary" to="new">
          New
        </Button>
      </div>
      <p className="mb-8 text-left">
        The latest announcement will be visible on the user's dashboard.
      </p>
      <Outlet />
    </div>
  );
}
