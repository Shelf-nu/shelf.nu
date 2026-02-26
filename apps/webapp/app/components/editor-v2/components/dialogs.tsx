import type { ChangeEvent } from "react";

import { Button } from "~/components/shared/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/shared/modal";

import type { LinkDialogState, RawBlockDialogState } from "../types";

interface LinkDialogProps {
  state: LinkDialogState;
  onClose: () => void;
  onHrefChange: (href: string) => void;
  onApply: () => void;
}

export function LinkDialog({
  state,
  onClose,
  onHrefChange,
  onApply,
}: LinkDialogProps) {
  return (
    <AlertDialog
      open={state.open}
      onOpenChange={(open) => (open ? null : onClose())}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Edit link</AlertDialogTitle>
          <AlertDialogDescription>
            Enter the URL for the selected text.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3">
          <label className="block text-sm font-medium text-color-700">
            URL
            <input
              type="url"
              value={state.href}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                onHrefChange(event.target.value)
              }
              className="mt-1 w-full rounded border border-color-300 px-2 py-1 text-[16px] focus:border-color-500 focus:outline-none focus:ring-2 focus:ring-color-200"
              placeholder="https://example.com"
            />
          </label>
        </div>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel asChild>
            <Button variant="secondary" type="button">
              Cancel
            </Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button type="button" onClick={onApply} className={"ml-0"}>
              Apply
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

interface RawBlockDialogProps {
  state: RawBlockDialogState;
  onClose: () => void;
  onChange: (raw: string) => void;
  onSave: () => void;
}

export function RawBlockDialog({
  state,
  onClose,
  onChange,
  onSave,
}: RawBlockDialogProps) {
  return (
    <AlertDialog
      open={state.open}
      onOpenChange={(open) => (open ? null : onClose())}
    >
      <AlertDialogContent className="max-w-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>Edit raw Markdoc block</AlertDialogTitle>
          <AlertDialogDescription>
            Unsupported Markdoc content is preserved as raw blocks. Updating the
            source will replace the block contents.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3">
          <textarea
            className="h-48 w-full rounded border border-color-300 p-2 font-mono text-sm focus:border-color-500 focus:outline-none focus:ring-2 focus:ring-color-200"
            value={state.raw}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
              onChange(event.target.value)
            }
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="secondary" type="button">
              Cancel
            </Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button type="button" onClick={onSave}>
              Save raw block
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
