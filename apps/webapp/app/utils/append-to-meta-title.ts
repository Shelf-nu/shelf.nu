/** Small helper that appends `shelf.nu` to the current route meta title */
export const appendToMetaTitle = (title: string | null | undefined) =>
  `${title ? title : "Not found"} | shelf.nu`;
