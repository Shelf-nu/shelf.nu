import type { User } from "@prisma/client";

export interface UpdateUserPayload {
  id: User["id"];
  username: User["username"];
  firstName?: User["firstName"];
  lastName?: User["lastName"];
}

export interface UpdateUserResponse {
  user: User | null;
  error: { message: string } | null;
}