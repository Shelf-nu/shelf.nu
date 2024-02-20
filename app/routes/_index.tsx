import { redirect } from "@remix-run/node";

export const loader = async () => redirect("/assets");

export default function Route() {
  return null;
}
