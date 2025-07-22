export function newOwnerEmailText({
  newOwnerName,
  workspaceName,
}: {
  newOwnerName: string;
  workspaceName: string;
}) {
  return `Hi ${newOwnerName},

You have successfully been assigned as the owner of the workspace "${workspaceName}".

This means you now have full control over:
- Workspace settings
- Billing and subscription
- User management

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

You have successfully transferred ownership of the workspace "${workspaceName}" to "${newOwnerName}".

As a result:
- You are now an admin in the workspace
- You no longer have access to billing or ownership-level settings

Thanks,
The Shelf Team
  `;
}
