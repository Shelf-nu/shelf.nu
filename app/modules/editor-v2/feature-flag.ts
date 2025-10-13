import { EDITOR_V2_WORKSPACES } from "~/utils/env";

const workspaceList = (EDITOR_V2_WORKSPACES || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

const ENABLED_FOR_ALL =
  workspaceList.includes("*") || workspaceList.includes("all");

export function isEditorV2Enabled(workspaceId: string | null | undefined) {
  if (!workspaceId) {
    return false;
  }

  if (ENABLED_FOR_ALL) {
    return true;
  }

  return workspaceList.includes(workspaceId);
}
