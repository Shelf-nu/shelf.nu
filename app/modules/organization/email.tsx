import { SERVER_URL } from "~/utils/env";

export function newOwnerEmailText({
  newOwnerName,
  workspaceName,
}: {
  newOwnerName: string;
  workspaceName: string;
}) {
  return `Hi ${newOwnerName},

You're now the owner of workspace "${workspaceName}".

You now control:
- Workspace settings
- Billing and subscription
- User management

→ Manage workspace: ${SERVER_URL}/account-details/workspace

Thanks,
The Shelf Team
`;
}

export function previousOwnerEmailText({
  previousOwnerName,
  newOwnerName,
  workspaceName,
}: {
  previousOwnerName: string;
  newOwnerName: string;
  workspaceName: string;
}) {
  return `Hi ${previousOwnerName},

You transferred ownership of "${workspaceName}" to ${newOwnerName}.

Your new role:
- You're now an admin
- You no longer have billing access
- You can't transfer ownership

→ View workspace: ${SERVER_URL}/account-details/workspace

Thanks,
The Shelf Team
  `;
}
