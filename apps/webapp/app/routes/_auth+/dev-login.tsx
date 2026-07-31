import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, Form } from "react-router";
import { db } from "~/database/db.server";
import {
  getSelectedOrganization,
  setSelectedOrganizationIdCookie,
} from "~/modules/organization/context.server";
import { setCookie } from "~/utils/cookies.server";

export async function loader({ context }: LoaderFunctionArgs) {
  if (process.env.NODE_ENV === "production") {
    return redirect("/login");
  }

  if (context.isAuthenticated) {
    return redirect("/assets");
  }

  // Fetch all users to display as options for local developer login
  const users = await db.user.findMany({
    select: {
      id: true,
      email: true,
    },
    orderBy: {
      email: "asc",
    },
  });

  return data({ users });
}

export async function action({ context, request }: ActionFunctionArgs) {
  if (process.env.NODE_ENV === "production") {
    return redirect("/login");
  }

  const formData = await request.formData();
  const userId = formData.get("userId") as string;

  if (!userId) {
    return data({ error: "User ID is required" }, { status: 400 });
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true },
  });

  if (!user) {
    return data({ error: "User not found" }, { status: 404 });
  }

  const authSession = {
    accessToken: "DEV_BYPASS",
    refreshToken: "DEV_BYPASS",
    userId: user.id,
    email: user.email,
    expiresIn: 3600,
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  };

  const { organizationId } = await getSelectedOrganization({
    userId: user.id,
    request,
  });

  context.setSession(authSession);

  return redirect("/assets", {
    headers: [setCookie(await setSelectedOrganizationIdCookie(organizationId))],
  });
}

export default function DevLoginRoute() {
  const { users } = useLoaderData<typeof loader>();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8 rounded-xl bg-white p-8 shadow-md">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Developer Auto-Login
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Local development bypass without Supabase Authentication
          </p>
        </div>

        {users.length === 0 ? (
          <div className="rounded-md bg-yellow-50 p-4">
            <p className="text-sm font-medium text-yellow-800">
              No users found in local database. Please run seed script first:
            </p>
            <code className="mt-2 block rounded bg-gray-100 p-2 font-mono text-xs text-gray-700">
              pnpm db:reset or pnpm db:seed
            </code>
          </div>
        ) : (
          <div className="mt-8 space-y-4">
            <p className="text-sm font-medium text-gray-700">
              Select a user to log in as:
            </p>
            <div className="flex flex-col gap-2">
              {users.map((u) => (
                <Form method="post" key={u.id}>
                  <input type="hidden" name="userId" value={u.id} />
                  <button
                    type="submit"
                    className="w-full rounded-md border border-gray-300 bg-white px-4 py-3 text-left text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                  >
                    <div className="font-semibold text-gray-900">{u.email}</div>
                    <div className="mt-0.5 font-mono text-xs text-gray-500">
                      {u.id}
                    </div>
                  </button>
                </Form>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
