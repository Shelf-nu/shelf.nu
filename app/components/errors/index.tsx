import { useLocation, useRouteError } from "@remix-run/react";

import { isRouteError } from "~/utils/http";
import { Button } from "../shared/button";

export const ErrorContent = () => {
  const loc = useLocation();
  const response = useRouteError();

  let title = "Oops, something went wrong";
  let message =
    "There was an unexpected error. Please refresh to try again. If the issues persists, please contact support.";
  let traceId;

  if (isRouteError(response)) {
    message = response.data.error.message;
    title = response.data.error.title || "Oops, something went wrong";
    traceId = response.data.error.traceId;
  }

  return (
    <div className="flex size-full items-center justify-center">
      <div className="flex flex-col items-center text-center">
        <span className="mb-5 size-[56px] text-primary">
          <ErrorIcon />
        </span>
        <h2 className="mb-2">{title}</h2>
        <p className="max-w-[550px]">{message}</p>
        {traceId && <p className="text-gray-400">(Trace id: {traceId})</p>}
        <div className=" mt-8 flex gap-3">
          <Button to="/" variant="secondary" icon="home">
            Back to home
          </Button>
          <Button to={loc.pathname} reloadDocument>
            Reload page
          </Button>
        </div>
      </div>
    </div>
  );
};

export const ErrorIcon = () => (
  <svg
    width="100%"
    height="100%"
    viewBox="0 0 56 56"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M56 0H0V56H56V0Z" fill="currentColor" />
    <rect x="11.9" y="25.375" width="4.2" height="18.375" fill="white" />
    <rect x="18.9" y="32.375" width="4.2" height="11.375" fill="white" />
    <rect x="25.9" y="25.375" width="4.2" height="18.375" fill="white" />
    <rect x="32.9" y="30.625" width="4.2" height="13.125" fill="white" />
    <rect x="39.9" y="25.375" width="4.2" height="18.375" fill="white" />
    <rect
      x="11.375"
      y="25.375"
      width="5.25"
      height="8.75"
      fill="currentColor"
    />
    <rect
      x="39.375"
      y="25.375"
      width="5.25"
      height="9.625"
      fill="currentColor"
    />
    <rect x="32" y="25" width="6" height="7" fill="currentColor" />
    <rect x="25" y="25" width="7" height="6" fill="currentColor" />
    <rect
      x="14"
      y="20.125"
      width="4.375"
      height="6.125"
      transform="rotate(-90 14 20.125)"
      fill="white"
    />
    <rect
      x="36.75"
      y="20.125"
      width="4.375"
      height="5.25"
      transform="rotate(-90 36.75 20.125)"
      fill="white"
    />
  </svg>
);
