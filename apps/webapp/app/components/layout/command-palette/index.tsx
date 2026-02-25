import type { ReactNode } from "react";

import { CommandPalette as CommandPaletteComponent } from "./command-palette";
import { CommandPaletteButton } from "./command-palette-button";
import {
  CommandPaletteProvider as CommandPaletteProviderComponent,
  useCommandPalette,
  useCommandPaletteSafe,
} from "./command-palette-context";

export { CommandPaletteButton, useCommandPalette, useCommandPaletteSafe };
export const CommandPalette = CommandPaletteComponent;
export const CommandPaletteProvider = CommandPaletteProviderComponent;

export function CommandPaletteRoot({ children }: { children: ReactNode }) {
  return (
    <CommandPaletteProviderComponent>
      {children}
      <CommandPaletteComponent />
    </CommandPaletteProviderComponent>
  );
}
