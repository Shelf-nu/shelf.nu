import { Button } from "~/components/shared/button";

interface LinkComponentProps {
  to: string;
  text: string;
}

/**
 * Generic component for rendering links in markdown content that open in new tabs
 * Can be used for users, bookings, assets, or any other entity links
 */
export function LinkComponent({ to, text }: LinkComponentProps) {
  return (
    <Button
      variant="link"
      to={to}
      target="_blank"
      className="h-auto p-0 font-semibold text-black underline hover:text-primary"
    >
      {text}
    </Button>
  );
}
