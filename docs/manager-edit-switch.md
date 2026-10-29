# Managers can add and edit assets and kits

An owner-only workspace switch (Settings > General > Permissions > Managers),
stored as `Organization.managersCanEditAssets`.

- **Off (default):** Managers keep a read-only catalogue. Every role answers exactly as before.
- **On:** Managers may create, duplicate and edit assets, update locations (single and bulk), link and relink QR codes and barcodes, and create and edit kits and their assets, on the web and the phone. They still cannot delete, archive, reinstate or import, run any other bulk edit, or create categories, locations, tags, custom fields or asset models.

Owners and Administrators are never affected. The grants live in `WORKSPACE_GRANTS` (`packages/permissions/src/workspace-grants.ts`); routes that share a granted permission but stay closed pass `workspaceGrants: false`.

The knowledge base page https://www.shelf.nu/knowledge-base/user-roles-and-their-permissions must be updated separately in the website-v2 repo.
