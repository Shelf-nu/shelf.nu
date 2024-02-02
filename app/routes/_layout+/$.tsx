import { ShelfStackError } from "~/utils/error";

export const loader = () => {
  // @TODO Solve error handling

  throw new ShelfStackError({
    title: "Not Found",
    message: "We couldn't find the page you were looking for",
    status: 404,
  });
};

/** This route is meant for handling 404 errors for logged in users  */
export default function LayoutSplat() {
  return null;
}
