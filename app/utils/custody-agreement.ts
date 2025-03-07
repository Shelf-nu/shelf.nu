import type { CustodySignatureStatus, CustodyStatus } from "@prisma/client";
import colors from "tailwindcss/colors";

export const CUSTODY_STATUS_COLOR: Record<CustodyStatus, string> = {
  ACTIVE: colors.yellow["500"],
  FINISHED: colors.green["500"],
  CANCELLED: colors.red["500"],
};

export const SIGN_STATUS_COLOR: Record<CustodySignatureStatus, string> = {
  NOT_REQUIRED: colors.gray["500"],
  CANCELLED: colors.red["500"],
  PENDING: colors.gray["500"],
  SIGNED: colors.green["500"],
};
