import { User } from "@prisma/client";

export interface UpdateUserPayload {
  id: string;
  name: string;
}
