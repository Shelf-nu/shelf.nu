import { SERVER_URL } from "~/utils";

export const assetReservedEmailContent = ({
  bookingName,
  custodian,
  from,
  to,
  bookingId,
  assetsCount,
}: {
  bookingName: string;
  assetsCount: number;
  custodian: string;
  from: string;
  to: string;
  bookingId: string;
}) => `Howdy,

Booking confirmation for ${custodian}.


${bookingName} | ${assetsCount}
Custodian: ${custodian}
From: ${from}
From: ${to}

To view the booking, follow the link below:
${SERVER_URL}/booking/${bookingId}

Thanks,
The Shelf Team
`;
