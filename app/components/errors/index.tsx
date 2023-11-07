import { useRouteError } from "@remix-run/react";
import { isShelfStackError } from "~/utils/error";

export const ErrorContent = () => {
  const response = useRouteError();

  if (isShelfStackError(response)) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="flex flex-col items-center text-center">
          <img src="/images/error-icon.svg" alt="" className="mb-5" />
          <h2 className="mb-2">{response.title}</h2>
          <p className="max-w-[550px]">{response.message}</p>

          <div className=" mt-8 flex gap-3"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="flex flex-col items-center text-center">
        <img src="/images/error-icon.svg" alt="" className="mb-5" />
        <h2 className="mb-2">Oops, something went wrong</h2>
        <p className="max-w-[550px]">
          An error has occured. Please refresh the page and try again. If the
          issue persists, please contact support.
        </p>

        <div className=" mt-8 flex gap-3"></div>
      </div>
    </div>
  );
};
