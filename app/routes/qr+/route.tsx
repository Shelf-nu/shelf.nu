import { redirect } from "@remix-run/node";

export const shouldRevalidate = () => false;
export const loader = () => redirect("/");
