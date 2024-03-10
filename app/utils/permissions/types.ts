import type { OrganizationRoles } from "@prisma/client";

export enum PermissionAction {
  create = "create",
  read = "read",
  update = "update",
  delete = "delete",
  checkout = "checkout",
  checkin = "checkin",
  export = "export",
  import = "import",
}
export enum PermissionEntity {
  asset = "asset",
  qr = "qr",
  booking = "booking",
  tag = "tag",
  category = "category",
  location = "location",
  customField = "customField",
  workspace = "workspace",
  teamMember = "teamMember",
  dashboard = "dashboard",
  generalSettings = "generalSettings",
  subscription = "subscription",
  template = "template",
}

export interface PermissionCheckProps {
  organizationId: string;
  roles?: OrganizationRoles[];
  userId: string;
  action: PermissionAction;
  entity: PermissionEntity;
}
