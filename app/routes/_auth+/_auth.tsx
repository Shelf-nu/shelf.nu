import type { LoaderArgs, LoaderFunction } from "@remix-run/node";
import { Link, useMatches } from "@remix-run/react";
import { Outlet, redirect } from "react-router";
import SubHeading from "~/components/shared/sub-heading";
import { getAuthSession } from "~/modules/auth";
import { getUserByEmail } from "~/modules/user";

export const loader: LoaderFunction = async ({ request }: LoaderArgs) => {
  const authSession = await getAuthSession(request);

  const user = authSession
    ? await getUserByEmail(authSession?.email)
    : undefined;

  if (user) {
    return redirect("assets");
  }
  return null;
};

export default function App() {
  const matches = useMatches();
  /** Find the title and subHeading from current route */
  const { title, subHeading } = matches[matches.length - 1].data;
  return (
    <div className="flex h-full min-h-screen flex-col ">
      <main className="flex h-full w-full ">
        <div className="flex h-full w-full flex-col items-center justify-center p-6 lg:p-10">
          <div className=" mb-8 text-center">
            <Link to="/">
              <img
                src="/images/shelf-symbol.png"
                alt="Shelf symbol"
                className=" mx-auto mb-2 h-12 w-12"
              />
            </Link>

            <h1>{title}</h1>
            <SubHeading>{subHeading}</SubHeading>
          </div>
          <div className=" w-[360px]">
            <Outlet />
          </div>
        </div>
        <aside className="relative hidden h-full items-end justify-end p-8 lg:flex lg:w-[700px] xl:w-[900px]">
          <a
            href="https://www.nga.gov/collection/art-object-page.52316.html"
            rel="noreferrer"
            target="_blank"
            className="relative z-20 w-[150px] text-right text-sm text-black no-underline hover:text-black"
          >
            John Singer Sargent <br />A Corner of the Library in Venice,
            1904/1907
          </a>
          <img
            className="absolute inset-0 h-full w-full max-w-none object-cover"
            src="/images/auth-cover.jpg"
            alt="John Singer Sargent - A Corner of the Library in Venice, 1904/1907 "
          />
        </aside>
      </main>
    </div>
  );
}
