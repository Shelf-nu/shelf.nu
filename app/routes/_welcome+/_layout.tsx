import { Outlet } from "react-router";

export default function OnboardingLayout() {
  return (
    <div className="flex h-full min-h-screen flex-col ">
      <main className="relative flex size-full">
        <div className="flex size-full flex-col items-center justify-center p-6 lg:p-10">
          <div className="w-[300px] rounded-xl bg-white shadow-xl sm:w-[400px]">
            <Outlet />
          </div>
        </div>
        <img
          src="/images/bg-overlay1.png"
          alt="bg-overlay"
          className="absolute right-0 top-0 -z-10 size-full object-cover"
        />
      </main>
    </div>
  );
}
