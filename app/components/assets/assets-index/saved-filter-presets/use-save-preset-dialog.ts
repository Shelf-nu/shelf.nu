import { useState } from "react";

/**
 * Hook to manage the save preset dialog state.
 * This hook can be used to share the dialog open/close state between components.
 *
 * @returns An object containing the dialog state and helper functions
 */
export function useSavePresetDialog() {
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);

  const openSaveDialog = () => setIsSaveDialogOpen(true);
  const closeSaveDialog = () => setIsSaveDialogOpen(false);

  return {
    isSaveDialogOpen,
    setIsSaveDialogOpen,
    openSaveDialog,
    closeSaveDialog,
  };
}
