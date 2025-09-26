import { createContext, useContext, useMemo, useState } from "react";

interface CommandPaletteContextValue {
  open: boolean;
  setOpen: (value: boolean) => void;
  toggle: () => void;
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(
  null
);

export function useCommandPalette() {
  const context = useContext(CommandPaletteContext);

  if (!context) {
    throw new Error(
      "useCommandPalette must be used within a CommandPaletteProvider"
    );
  }

  return context;
}

export function useCommandPaletteSafe() {
  const context = useContext(CommandPaletteContext);
  return context;
}

export function CommandPaletteProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  const value = useMemo(
    () => ({
      open,
      setOpen,
      toggle: () => setOpen((previous) => !previous),
    }),
    [open]
  );

  return (
    <CommandPaletteContext.Provider value={value}>
      {children}
    </CommandPaletteContext.Provider>
  );
}
