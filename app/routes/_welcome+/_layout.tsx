import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Outlet } from "react-router";
import { ErrorContent } from "~/components/errors";
import { getUserByID } from "~/modules/user/service.server";
import { ENABLE_PREMIUM_FEATURES } from "~/utils/env";
import { makeShelfError } from "~/utils/error";
import { error } from "~/utils/http.server";

export async function loader({ context }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  try {
    if (!ENABLE_PREMIUM_FEATURES) {
      return redirect("/assets");
    }
    const user = await getUserByID(userId);
    /** If the user is already onboarded, we assume they finished the process so we send them to the index */
    // @TODO uncomment this before release
    if (user.onboarded) {
      return redirect("/assets");
    }

    return null;
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
}

export default function OnboardingLayout() {
  return (
    <div className="flex h-full min-h-screen flex-col ">
      <main className="relative flex size-full">
        <div className="flex size-full flex-col items-center justify-center p-6 lg:p-10">
          <div className="w-[400px] rounded-xl bg-white shadow-xl md:w-[560px]">
            <Outlet />
          </div>
        </div>
        <img
          src="/static/images/bg-overlay1.png"
          alt="bg-overlay"
          className="absolute right-0 top-0 -z-10 size-full object-cover"
        />
      </main>
    </div>
  );
}

export const ErrorBoundary = () => <ErrorContent />;
