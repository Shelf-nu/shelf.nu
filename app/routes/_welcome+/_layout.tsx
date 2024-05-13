import { Outlet } from "react-router";
import { ErrorContent } from "~/components/errors";

export default function OnboardingLayout() {
  return (
    <div className="flex h-full min-h-screen flex-col ">
      <main className="relative flex size-full">
        <div className="flex size-full flex-col items-center justify-center p-6 lg:p-10">
          <div className="w-[400px] rounded-xl bg-white shadow-xl md:w-[560px]">
            <Outlet />
          </div>
        </div>
        <img
          src="/static/images/bg-overlay1.png"
          alt="bg-overlay"
          className="absolute right-0 top-0 -z-10 size-full object-cover"
        />
      </main>
    </div>
  );
}

export const ErrorBoundary = () => <ErrorContent />;
