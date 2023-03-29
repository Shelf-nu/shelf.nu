import { Button } from "../shared/button";

export const EmptyState = () => (
  <div className="flex h-full flex-col justify-center gap-[32px] py-[150px] text-center">
    <div className="flex flex-col items-center">
      <img
        src="/images/empty-state.svg"
        alt="Empty state"
        className="h-auto w-[172px]"
      />

      <div className="text-text-lg font-semibold text-gray-900">
        No Items on database
      </div>
      <p>What are you waiting for? Create your first item now!</p>
    </div>
    <div>
      <Button to="new" aria-label="new item" icon="plus">
        New Item
      </Button>
    </div>
  </div>
);
