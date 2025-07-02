import { SERVER_URL } from "~/utils/env";

export function custodyAgreementSignedEmailText({
  custodianName,
  agreementName,
  receiptId,
}: {
  custodianName: string;
  agreementName: string;
  receiptId: string;
}) {
  return `Howdy,
  
${custodianName} has signed the custody agreement "${agreementName}".
You can view the signed custody receipt here: 

${SERVER_URL}/receipts?receiptId=${receiptId}

Thanks,
The Shelf Team
`;
}
