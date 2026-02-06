export function newOwnerEmailText({
  newOwnerName,
  workspaceName,
  subscriptionTransferred = false,
}: {
  newOwnerName: string;
  workspaceName: string;
  subscriptionTransferred?: boolean;
}) {
  const subscriptionSection = subscriptionTransferred
    ? `
Additionally, the previous owner's subscription has been transferred to you.

The current billing cycle continues unchanged - you won't be charged until the next billing date. However, you will need to add your own payment method before then to avoid any interruption in service.

You can manage your subscription and add a payment method from your account settings.
`
    : "";

  return `Hi ${newOwnerName},

You have successfully been assigned as the owner of the workspace "${workspaceName}".

This means you now have full control over:
- Workspace settings
- Billing and subscription
- User management
${subscriptionSection}
Thanks,
The Shelf Team
`;
}

export function previousOwnerEmailText({
  previousOwnerName,
  newOwnerName,
  workspaceName,
  subscriptionTransferred = false,
}: {
  previousOwnerName: string;
  newOwnerName: string;
  workspaceName: string;
  subscriptionTransferred?: boolean;
}) {
  const subscriptionSection = subscriptionTransferred
    ? `
Your subscription has also been transferred to ${newOwnerName}. This means:
- ${newOwnerName} now manages the billing for this workspace
- Your account has been downgraded to the free tier
- If you have other team workspaces, you may need to subscribe again to access premium features
`
    : "";

  return `Hi ${previousOwnerName},

You have successfully transferred ownership of the workspace "${workspaceName}" to "${newOwnerName}".

As a result:
- You are now an admin in the workspace
- You no longer have access to billing or ownership-level settings
${subscriptionSection}
Thanks,
The Shelf Team
`;
}
