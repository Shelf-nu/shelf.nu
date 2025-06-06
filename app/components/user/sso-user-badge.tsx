import { GrayBadge } from "../shared/gray-badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../shared/tooltip";

export const SSOUserBadge = ({
  userId,
  sso,
}: {
  userId: string;
  sso: boolean;
}) => {
  if (!sso) return null;

  return (
    <TooltipProvider key={userId}>
      <Tooltip>
        <TooltipTrigger>
          <GrayBadge className="ml-2">SSO</GrayBadge>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-72">
          <h4>SSO user</h4>

          <p className="mt-2">
            This user is using Single Sign-On (SSO) to log in to Shelf. Their
            access is managed by an external identity provider. On every login
            attempt, their permissions and access will be revalidated. If you
            want to remove them immediately, use the revoke access user action
            in Shelf. You will still need to remove them from the IDP to make
            this complete.
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
