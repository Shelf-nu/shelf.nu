import { useLoaderData } from "@remix-run/react";
import { NewNote } from "./new";

export const Notes = () => {
  const { notes } = useLoaderData();
  return (
    <div>
      Notes
      <NewNote />
    </div>
  );
};
