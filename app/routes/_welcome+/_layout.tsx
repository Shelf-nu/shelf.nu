import { Outlet } from "react-router";
import { ErrorContent } from "~/components/errors";
import { useCrisp } from "~/components/marketing/crisp";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export const meta = () => [{ title: appendToMetaTitle("Welcome") }];

export default function OnboardingLayout() {
  useCrisp();

  return (
    <div className="relative flex min-h-screen flex-col md:h-full">
      <main className="flex size-full overflow-y-auto">
        <div className="flex size-full flex-col items-center p-6 lg:p-10">
          <div className="max-h-[calc(100vh-3rem)] w-full overflow-y-auto rounded-xl bg-white shadow-xl md:w-[650px]">
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
