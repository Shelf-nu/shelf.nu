/**
 * @file Entry point for the bulk asset update page (/assets/import-update).
 * Renders instructional UI explaining the CSV-based bulk update workflow
 * and embeds the {@link UpdateImportForm} for the upload/preview/apply flow.
 *
 * @see {@link file://./form.tsx} Upload/preview/apply orchestration
 * @see {@link file://./../../../routes/_layout+/assets.import-update.tsx} Route handler
 */
import { useState } from "react";
import { UpdateImportForm } from "./form";
import Icon from "../../icons/icon";
import { Button } from "../../shared/button";

/**
 * Main content component for the bulk asset update page.
 * Displays step-by-step instructions (collapsible after analysis)
 * and embeds the CSV upload form.
 */
export const ImportUpdateContent = () => {
  const [showInstructions, setShowInstructions] = useState(true);

  return (
    <div className="w-full text-left">
      <h3>Update existing assets</h3>
      <p>
        Edit your assets in Excel or Google Sheets, then upload the CSV here.
        We'll show you exactly what will change before anything is saved.
      </p>

      {showInstructions ? (
        <>
          {/* Step 1: Get the CSV */}
          <div className="my-4 flex items-center gap-3 rounded-md border border-gray-200 bg-gray-50 p-4">
            <Icon
              icon="download"
              size="xs"
              className="shrink-0 text-gray-500"
            />
            <div className="flex-1">
              <p className="text-[14px] text-gray-600">
                <b>Step 1:</b> Go to the{" "}
                <Button variant="link" to="/assets">
                  Asset Index
                </Button>
                , select the assets you want to update, and export them. Make
                sure your export includes the <b>Asset ID</b> or <b>ID</b>{" "}
                column so we can match rows to existing assets.
              </p>
            </div>
            <Button variant="secondary" to="/assets">
              Go to Asset Index
            </Button>
          </div>

          <div className="my-5 flex flex-col gap-4">
            {/* What you can update */}
            <div className="flex gap-3">
              <Icon
                icon="pen"
                size="xs"
                className="mt-0.5 shrink-0 text-gray-500"
              />
              <div>
                <h5 className="font-semibold">What you can update</h5>
                <p className="text-[14px] text-gray-600">
                  Name, Category, Location, Tags, Valuation, Available to book,
                  and your custom fields (Text, Boolean, Date, Option, Number,
                  Currency).
                </p>
                <p className="mt-1 text-[14px] text-gray-600">
                  <b>Not supported yet:</b> Description, Status, Kit, and
                  Custody can't be bulk-updated via CSV — Status and Custody
                  have their own workflows, and Description can lose formatting
                  during export. These columns will be safely skipped if present
                  in your file.
                </p>
              </div>
            </div>

            {/* Empty cells */}
            <div className="flex gap-3">
              <Icon
                icon="check"
                size="xs"
                className="mt-0.5 shrink-0 text-gray-500"
              />
              <div>
                <h5 className="font-semibold">Empty cells clear values</h5>
                <p className="text-[14px] text-gray-600">
                  If a field currently has a value and you leave the cell empty,
                  that value will be cleared. Fields that are already empty stay
                  unchanged. Name and boolean fields (Yes/No) cannot be cleared.
                </p>
              </div>
            </div>

            {/* Matching */}
            <div className="flex gap-3">
              <Icon
                icon="asset"
                size="xs"
                className="mt-0.5 shrink-0 text-gray-500"
              />
              <div>
                <h5 className="font-semibold">How assets are matched</h5>
                <p className="text-[14px] text-gray-600">
                  By <b>Asset ID</b> or <b>ID</b> — keep these columns as they
                  are. Categories, locations, and tags that don't exist yet will
                  be created for you.
                </p>
              </div>
            </div>

            {/* Limits */}
            <div className="flex gap-3">
              <Icon
                icon="settings"
                size="xs"
                className="mt-0.5 shrink-0 text-gray-500"
              />
              <div>
                <h5 className="font-semibold">Limits</h5>
                <p className="text-[14px] text-gray-600">
                  You can update up to <b>1,000 assets</b> per file. For larger
                  batches, split your CSV into multiple files.
                </p>
              </div>
            </div>
          </div>

          <p className="text-[14px] text-gray-500">
            <b>Tip:</b> Just need to change one field on many assets? Select
            them in the{" "}
            <Button variant="link" to="/assets">
              Asset Index
            </Button>{" "}
            and use <b>Actions</b> — no CSV needed.
          </p>

          <p className="mt-1 text-[14px] text-gray-400">
            Looking to create new assets instead?{" "}
            <Button variant="link" to="/assets/import">
              Use the standard import
            </Button>
          </p>
        </>
      ) : (
        <button
          type="button"
          className="my-2 text-sm text-gray-500 underline"
          onClick={() => setShowInstructions(true)}
        >
          Show instructions
        </button>
      )}

      <UpdateImportForm
        onStageChange={(stage) => {
          if (stage === "preview" || stage === "results") {
            setShowInstructions(false);
          } else if (stage === "upload") {
            setShowInstructions(true);
          }
        }}
      />
    </div>
  );
};
