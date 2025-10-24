import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

import { filterSlashCommands } from "../helpers";
import type { SlashCommandItem, SlashState } from "../types";

export function useSlashCommands(
  commands: SlashCommandItem[],
  viewRef: React.RefObject<EditorView | null>
) {
  const [slashState, setSlashState] = useState<SlashState | null>(null);
  const slashStateRef = useRef<SlashState | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const slashIndexRef = useRef(0);
  const filteredCommandsRef = useRef<SlashCommandItem[]>([]);

  const updateSlash = useCallback((state: EditorState, view: EditorView) => {
    if (!state.selection.empty) {
      setSlashState(null);
      slashStateRef.current = null;
      return;
    }
    const { $from } = state.selection;
    if (!$from || !$from.parent) {
      setSlashState(null);
      slashStateRef.current = null;
      return;
    }
    const textBefore = $from.parent.textBetween(
      0,
      $from.parentOffset,
      undefined,
      "\ufffc"
    );
    const slashIndex = textBefore.lastIndexOf("/");
    let from: number | null = null;
    let query = "";

    if (slashIndex !== -1) {
      const prefix = textBefore.slice(0, slashIndex);
      if (prefix && /[^\s]$/.test(prefix)) {
        setSlashState(null);
        slashStateRef.current = null;
        slashIndexRef.current = 0;
        return;
      }
      query = textBefore.slice(slashIndex + 1);
      if (!/^[\w-]*$/.test(query)) {
        setSlashState(null);
        slashStateRef.current = null;
        slashIndexRef.current = 0;
        return;
      }
      from = state.selection.from - query.length - 1;
    } else if (slashStateRef.current?.active) {
      const previous = slashStateRef.current;
      const selectionFrom = state.selection.from;
      const slashChar = state.doc.textBetween(
        previous.from,
        previous.from + 1,
        undefined,
        "\ufffc"
      );

      if (selectionFrom < previous.from || slashChar !== "/") {
        setSlashState(null);
        slashStateRef.current = null;
        slashIndexRef.current = 0;
        return;
      }

      from = previous.from;
      query = state.doc.textBetween(
        previous.from + 1,
        selectionFrom,
        undefined,
        "\ufffc"
      );

      if (!/^[\w-]*$/.test(query)) {
        setSlashState(null);
        slashStateRef.current = null;
        slashIndexRef.current = 0;
        return;
      }
    }

    if (from == null || from < 0 || !Number.isFinite(from)) {
      setSlashState(null);
      slashStateRef.current = null;
      slashIndexRef.current = 0;
      return;
    }

    const to = state.selection.from;
    const nextSlashState: SlashState = {
      active: true,
      query,
      from,
      to,
      left: 0,
      top: 0,
    };

    try {
      const coords = view.coordsAtPos(from);
      nextSlashState.left = coords.left;
      nextSlashState.top = coords.bottom + 6;
    } catch {
      const fallback = (view.dom as HTMLElement)?.getBoundingClientRect();
      nextSlashState.left = fallback?.left ?? 0;
      nextSlashState.top = (fallback?.bottom ?? 0) + 6;
    }

    setSlashIndex(0);
    slashIndexRef.current = 0;
    slashStateRef.current = nextSlashState;
    setSlashState(nextSlashState);
  }, []);

  const applySlashCommand = useCallback(
    (command: SlashCommandItem) => {
      const view = viewRef.current;
      const currentSlash = slashStateRef.current;
      if (!view || !currentSlash) return;
      const { state } = view;

      // Find the end of the slash command text by scanning forward for word characters
      // This is more robust than relying on cursor position, which may be stale
      const deleteFrom = currentSlash.from;
      let deleteTo = deleteFrom + 1; // Start after the "/"

      // Scan forward while we have word characters (letters, numbers, underscore, hyphen)
      while (deleteTo < state.doc.content.size) {
        const char = state.doc.textBetween(
          deleteTo,
          deleteTo + 1,
          undefined,
          "\ufffc"
        );
        if (/[\w-]/.test(char)) {
          deleteTo++;
        } else {
          break;
        }
      }

      const slice = state.doc.textBetween(
        deleteFrom,
        deleteTo,
        undefined,
        "\ufffc"
      );

      slashStateRef.current = null;
      setSlashState(null);
      setSlashIndex(0);
      slashIndexRef.current = 0;

      if (slice.startsWith("/")) {
        const tr = state.tr.delete(deleteFrom, deleteTo);
        view.dispatch(tr);
      }

      command.command(view.state, view.dispatch, view);
      view.focus();
    },
    [viewRef]
  );

  const handleSlashKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const state = slashStateRef.current;
      const commandsList = filteredCommandsRef.current;
      if (!state?.active || commandsList.length === 0) {
        return false;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSlashIndex((index) => (index + 1) % commandsList.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSlashIndex(
          (index) => (index - 1 + commandsList.length) % commandsList.length
        );
        return true;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const command = commandsList[slashIndexRef.current] ?? commandsList[0];
        if (command) {
          applySlashCommand(command);
        }
        return true;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setSlashState(null);
        setSlashIndex(0);
        return true;
      }
      return false;
    },
    [applySlashCommand]
  );

  const filteredCommands = useMemo(
    () => filterSlashCommands(commands, slashState?.query ?? ""),
    [commands, slashState]
  );

  useEffect(() => {
    filteredCommandsRef.current = filteredCommands;
  }, [filteredCommands]);

  useEffect(() => {
    if (!slashState) {
      setSlashIndex(0);
    }
    slashStateRef.current = slashState;
  }, [slashState]);

  useEffect(() => {
    slashIndexRef.current = slashIndex;
  }, [slashIndex]);

  return {
    slashState,
    slashIndex,
    filteredCommands,
    updateSlash,
    applySlashCommand,
    handleSlashKeyDown,
    setSlashIndex,
  };
}
