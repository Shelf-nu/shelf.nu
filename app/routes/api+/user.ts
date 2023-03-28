import type { LoaderArgs } from "@remix-run/node";
import { json } from "react-router";
import { requireAuthSession } from "~/modules/auth";
import { getUserByID } from "~/modules/user";

export async function loader({ request }: LoaderArgs) {
  try {
    const { userId } = await requireAuthSession(request);
    const user = getUserByID(userId);
    return json({ user });
  } catch (error) {
    return json({ error });
  }
}
