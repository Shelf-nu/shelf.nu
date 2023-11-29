import type { Template, User } from "@prisma/client";

export enum TemplateType {
    CUSTODY = "Custody",
    BOOKINGS = "Bookings",
}

export interface CreateTemplatePayload {
    name: string;
    type: TemplateType;
    description?: string;
    signatureRequired: boolean;
    userId: User["id"];
};

export interface UpdateTemplatePayload {
    id: Template["id"];
    type?: TemplateType;
    name?: Template["name"];
    description?: Template["description"];
    signatureRequired?: Template["signatureRequired"];
    userId: User["id"];
};