import * as React from "react";

import type { LoaderArgs, V2_MetaFunction } from "@remix-run/node";
import { redirect, json } from "@remix-run/node";
import { useSearchParams } from "@remix-run/react";
import { Button } from "~/components/shared/button";

import { getAuthSession, ContinueWithEmailForm } from "~/modules/auth";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export async function loader({ request }: LoaderArgs) {
  const authSession = await getAuthSession(request);
  const title = "Create an account";
  const subHeading = "Start your journey with Shelf";

  if (authSession) return redirect("/");

  return json({ title, subHeading });
}

export const meta: V2_MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.title) : "" },
];

export default function Join() {
  const [searchParams] = useSearchParams();

  return (
    <div className="w-full max-w-md">
      <div className="">
        <ContinueWithEmailForm />
      </div>
      <div className="mt-6 flex items-center justify-center">
        <div className="text-center text-sm text-gray-500">
          Already have an account?{" "}
          <Button
            variant="link"
            to={{
              pathname: "/",
              search: searchParams.toString(),
            }}
          >
            Log in
          </Button>
        </div>
      </div>
    </div>
  );
}
