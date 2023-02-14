import type { LoaderArgs } from "@remix-run/node";
import { Link } from "@remix-run/react";

import { requireAuthSession } from "~/modules/auth";

export async function loader({ request }: LoaderArgs) {
  await requireAuthSession(request);

  return null;
}

export default function NoteIndexPage() {
  return (
    <>
      <p>
        No note selected. Select a note on the left, or{" "}
        <Link to="new" className="text-blue-500 underline">
          create a new note.
        </Link>
      </p>
    </>
  );
}
