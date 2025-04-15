import { SERVER_URL } from "~/utils/env";

export function kitCustodyAssignedWithAgreementEmailText({
  kitName,
  assignerName,
  kitId,
  custodyId,
  signatureRequired,
}: {
  kitName: string;
  assignerName: string;
  kitId: string;
  custodyId: string;
  signatureRequired: boolean;
}) {
  return `Howdy,
  
  ${assignerName} has assigned you as custodian for ${kitName}.
  Please click the link below to view the custody agreement ${
    signatureRequired ? "and sign it" : ""
  }:
  ${SERVER_URL}/sign/kit-custody/${custodyId}
  
  To view the kit, please click the link below:
  ${SERVER_URL}/kits/${kitId}
  
  Thanks,
  The Shelf Team
  `;
}
