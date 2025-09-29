import { SERVER_URL } from "~/utils/env";

/**
 * THis is the text version of the onboarding email
 */
export const onboardingEmailText = ({
  firstName,
}: {
  firstName: string;
}) => `Hi ${firstName},

Carlos here, founder of Shelf. Welcome!

Get started in 3 steps:

1. Add your first asset (2 min) → ${SERVER_URL}/assets/new
2. Generate a QR code (1 click)
3. Invite your team (optional)

I built Shelf because asset chaos drove me crazy. Spreadsheets failing. Assets missing. Hours wasted.

You don't need to master everything today. Just add one asset.

Need help? Hit reply. Goes straight to my inbox.

Need labels? → http://store.shelf.nu

Best,
Carlos A. Virreira
Founder / CEO
Shelf Asset Management, Inc.
`;
