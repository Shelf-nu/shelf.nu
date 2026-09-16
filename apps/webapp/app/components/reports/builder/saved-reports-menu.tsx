/**
 * "Saved reports" control on the builder page.
 *
 * A popover lists the workspace's saved reports; picking one navigates to
 * `/reports/builder?<its query>`. Each row offers rename and delete, and the
 * popover's footer saves the report currently shown. All three mutations post
 * to the builder route's action through fetchers, so the page stays put and
 * the list refreshes on revalidation.
 *
 * Saved reports are shared by the whole workspace, so no row is "mine": every
 * Owner and Admin can rename or delete every entry.
 *
 * @see {@link file://../../../routes/_layout+/reports.builder.tsx}
 * @see {@link file://../../../modules/reports/saved/service.server.ts}
 */

import { useEffect, useReducer, type ChangeEvent } from "react";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { BookMarked, Check, Pencil, Save, Trash2 } from "lucide-react";
import { useFetcher, useLocation, useNavigate } from "react-router";
import { Button } from "~/components/shared/button";
import { describeSavedReportQuery } from "~/modules/reports/saved/describe";
import {
  sanitizeSavedReportQuery,
  savedReportQueryEquals,
} from "~/modules/reports/saved/query";
import { isFormProcessing } from "~/utils/form";
import type { DataOrErrorResponse } from "~/utils/http.server";
import { tw } from "~/utils/tw";
import { RenameReportDialog } from "./rename-report-dialog";
import { SaveReportDialog } from "./save-report-dialog";

/** The part of a saved report the menu renders. */
export type SavedReportListItem = {
  id: string;
  name: string;
  query: string;
};

/** Props for {@link SavedReportsMenu}. */
type Props = {
  savedReports: SavedReportListItem[];
  /** Disables the trigger while a navigation is in flight. */
  disabled?: boolean;
};

type UiState = {
  open: boolean;
  saveOpen: boolean;
  saveName: string;
  renaming: SavedReportListItem | null;
  renameValue: string;
};

type UiAction =
  | { type: "setOpen"; open: boolean }
  | { type: "openSave" }
  | { type: "closeSave" }
  | { type: "setSaveName"; value: string }
  | { type: "openRename"; report: SavedReportListItem }
  | { type: "closeRename" }
  | { type: "setRenameValue"; value: string };

const INITIAL_UI: UiState = {
  open: false,
  saveOpen: false,
  saveName: "",
  renaming: null,
  renameValue: "",
};

function uiReducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case "setOpen":
      return { ...state, open: action.open };
    case "openSave":
      return { ...state, open: false, saveOpen: true, saveName: "" };
    case "closeSave":
      return { ...state, saveOpen: false, saveName: "" };
    case "setSaveName":
      return { ...state, saveName: action.value };
    case "openRename":
      return {
        ...state,
        open: false,
        renaming: action.report,
        renameValue: action.report.name,
      };
    case "closeRename":
      return { ...state, renaming: null, renameValue: "" };
    case "setRenameValue":
      return { ...state, renameValue: action.value };
  }
}

/** Renders the trigger, the list popover and the two dialogs. */
export function SavedReportsMenu({ savedReports, disabled }: Props) {
  const [ui, dispatch] = useReducer(uiReducer, INITIAL_UI);
  const location = useLocation();
  const navigate = useNavigate();

  const saveFetcher = useFetcher<DataOrErrorResponse>({ key: "save-report" });
  const renameFetcher = useFetcher<DataOrErrorResponse>({
    key: "rename-report",
  });

  // A finished, error-free submission closes its dialog. The action data is
  // the only signal of success the fetcher exposes.
  const saveSucceeded =
    saveFetcher.state === "idle" &&
    saveFetcher.data !== undefined &&
    !saveFetcher.data.error;
  useEffect(() => {
    if (saveSucceeded) dispatch({ type: "closeSave" });
  }, [saveSucceeded]);

  const renameSucceeded =
    renameFetcher.state === "idle" &&
    renameFetcher.data !== undefined &&
    !renameFetcher.data.error;
  useEffect(() => {
    if (renameSucceeded) dispatch({ type: "closeRename" });
  }, [renameSucceeded]);

  const currentQuery = sanitizeSavedReportQuery(location.search);
  const activeReport = savedReports.find((report) =>
    savedReportQueryEquals(report.query, currentQuery)
  );

  const openReport = (report: SavedReportListItem) => {
    dispatch({ type: "setOpen", open: false });
    void navigate({ pathname: "/reports/builder", search: `?${report.query}` });
  };

  return (
    <>
      <Popover
        open={ui.open}
        onOpenChange={(open) => dispatch({ type: "setOpen", open })}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="secondary"
            disabled={disabled}
            className="whitespace-nowrap"
          >
            <BookMarked className="mr-1.5 inline size-4 text-gray-500" />
            {activeReport ? activeReport.name : "Saved reports"}
            {savedReports.length > 0 ? (
              <span className="ml-1.5 inline-flex size-5 items-center justify-center rounded-full bg-gray-100 text-xs font-medium text-gray-700">
                {savedReports.length}
              </span>
            ) : null}
          </Button>
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent
            align="end"
            className="z-[100] mt-1 w-[360px] rounded-md border border-gray-200 bg-white p-0 shadow-lg"
          >
            <div className="border-b border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700">
              Saved reports
            </div>

            {savedReports.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
                <BookMarked className="size-6 text-gray-300" />
                <p className="text-sm text-gray-600">No saved reports yet</p>
                <p className="text-xs text-gray-500">
                  Set up a report and save it so the whole team can open it with
                  one click.
                </p>
              </div>
            ) : (
              <div className="max-h-[320px] overflow-y-auto py-1">
                {savedReports.map((report) => (
                  <SavedReportRow
                    key={report.id}
                    report={report}
                    isActive={activeReport?.id === report.id}
                    onOpen={openReport}
                    onRename={(r) =>
                      dispatch({ type: "openRename", report: r })
                    }
                  />
                ))}
              </div>
            )}

            <div className="border-t border-gray-200 p-2">
              <Button
                type="button"
                variant="secondary"
                width="full"
                onClick={() => dispatch({ type: "openSave" })}
              >
                <span className="inline-flex items-center gap-1.5">
                  <Save className="size-4" />
                  Save current report
                </span>
              </Button>
            </div>
          </PopoverContent>
        </PopoverPortal>
      </Popover>

      <SaveReportDialog
        open={ui.saveOpen}
        onClose={() => dispatch({ type: "closeSave" })}
        query={currentQuery}
        name={ui.saveName}
        onNameChange={(e: ChangeEvent<HTMLInputElement>) =>
          dispatch({ type: "setSaveName", value: e.target.value })
        }
        fetcher={saveFetcher}
      />

      <RenameReportDialog
        open={ui.renaming !== null}
        onClose={() => dispatch({ type: "closeRename" })}
        reportId={ui.renaming?.id ?? ""}
        name={ui.renameValue}
        onNameChange={(e: ChangeEvent<HTMLInputElement>) =>
          dispatch({ type: "setRenameValue", value: e.target.value })
        }
        fetcher={renameFetcher}
      />
    </>
  );
}

/** One saved report in the list: open on click, rename and delete on hover. */
function SavedReportRow({
  report,
  isActive,
  onOpen,
  onRename,
}: {
  report: SavedReportListItem;
  isActive: boolean;
  onOpen: (report: SavedReportListItem) => void;
  onRename: (report: SavedReportListItem) => void;
}) {
  // One fetcher per row so two deletes never share state.
  const deleteFetcher = useFetcher({ key: `delete-report-${report.id}` });
  const isDeleting = isFormProcessing(deleteFetcher.state);

  // The row disappears as soon as the delete is submitted.
  if (isDeleting) return null;

  return (
    <div
      className={tw(
        "group flex items-start gap-2 px-3 py-2 hover:bg-gray-50",
        isActive && "bg-gray-50"
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(report)}
        className="flex-1 overflow-hidden text-left"
        title={report.name}
      >
        <div className="flex items-center gap-1.5 text-sm font-medium text-gray-900">
          <span className="truncate">{report.name}</span>
          {isActive ? (
            <span
              className="flex size-4 shrink-0 items-center justify-center rounded-full bg-gray-200"
              title="Currently open"
            >
              <Check className="size-3 text-gray-700" />
            </span>
          ) : null}
        </div>
        <div className="truncate text-xs text-gray-500">
          {describeSavedReportQuery(report.query)}
        </div>
      </button>

      <div className="mt-0.5 flex gap-1 opacity-0 focus-within:opacity-100 group-hover:opacity-100">
        <button
          type="button"
          onClick={() => onRename(report)}
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          title="Rename"
          aria-label={`Rename ${report.name}`}
        >
          <Pencil className="size-3.5" />
        </button>
        <deleteFetcher.Form method="post" className="inline">
          <input type="hidden" name="intent" value="delete-report" />
          <input type="hidden" name="reportId" value={report.id} />
          <button
            type="submit"
            onClick={(e) => {
              if (!confirm(`Delete the saved report "${report.name}"?`)) {
                e.preventDefault();
              }
            }}
            className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500"
            title="Delete"
            aria-label={`Delete ${report.name}`}
          >
            <Trash2 className="size-3.5" />
          </button>
        </deleteFetcher.Form>
      </div>
    </div>
  );
}
