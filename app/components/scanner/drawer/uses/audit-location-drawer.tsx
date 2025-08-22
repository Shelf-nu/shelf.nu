import { useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { 
  auditResultsAtom, 
  auditSessionAtom,
  clearScannedItemsAtom,
  removeScannedItemAtom,
  removeMultipleScannedItemsAtom,
} from "~/atoms/qr-scanner";
import { Form } from "~/components/custom-form";
import { CheckmarkIcon } from "~/components/icons/library";
import { Button } from "~/components/shared/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/shared/modal";
import { Spinner } from "~/components/shared/spinner";
import { useDisabled } from "~/hooks/use-disabled";
import { tw } from "~/utils/tw";
import { createBlockers } from "../blockers-factory";
import ConfigurableDrawer from "../configurable-drawer";
import {
  GenericItemRow,
  DefaultLoadingState,
  TextLoader,
} from "../generic-item-row";

type AuditState = {
  status: "processing" | "success" | "error";
  errorMessage?: string;
};

/**
 * Drawer component for location audit management
 */
export default function AuditLocationDrawer({
  className,
  style,
  isLoading,
  defaultExpanded = false,
  location,
}: {
  className?: string;
  style?: React.CSSProperties;
  isLoading?: boolean;
  defaultExpanded?: boolean;
  location: { id: string; name: string };
}) {
  const auditResults = useAtomValue(auditResultsAtom);
  const auditSession = useAtomValue(auditSessionAtom);
  const clearList = useSetAtom(clearScannedItemsAtom);
  const removeItem = useSetAtom(removeScannedItemAtom);
  const removeItemsFromList = useSetAtom(removeMultipleScannedItemsAtom);
  
  const [auditState, setAuditState] = useState<AuditState>({
    status: "processing",
  });
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const disabled = useDisabled();

  const { found, missing, unexpected } = auditResults;
  const hasResults = found.length > 0 || missing.length > 0 || unexpected.length > 0;

  // Create blockers configuration (none needed for audit, but following pattern)
  const blockerConfigs: never[] = [];

  // Create blockers component
  const [hasBlockers, Blockers] = createBlockers({
    blockerConfigs,
    onResolveAll: () => {},
  });

  const handleStartAudit = () => {
    setAuditState({ status: "processing" });
  };

  const handleCompleteAudit = () => {
    setShowConfirmDialog(true);
  };

  const handleCancelAudit = () => {
    clearList();
    setAuditState({ status: "processing" });
  };

  if (!auditSession) {
    return (
      <ConfigurableDrawer
        title="Start Location Audit"
        description={`Begin auditing assets in ${location.name}`}
        className={className}
        style={style}
        defaultExpanded={defaultExpanded}
        actionButtons={
          <Form method="post">
            <input type="hidden" name="intent" value="start-audit" />
            <input 
              type="hidden" 
              name="expectedAssetCount" 
              value={missing.length} 
            />
            <Button
              type="submit"
              disabled={disabled}
              onClick={handleStartAudit}
            >
              Start Audit
            </Button>
          </Form>
        }
      >
        <div className="space-y-4">
          <p className="text-gray-700">
            This will start an audit session for <strong>{location.name}</strong>.
          </p>
          <div className="bg-gray-50 p-3 rounded-lg">
            <p className="text-sm">
              Expected assets: <strong>{missing.length}</strong>
            </p>
            <p className="text-xs text-gray-600 mt-1">
              Scan assets to verify their presence in this location.
            </p>
          </div>
        </div>
      </ConfigurableDrawer>
    );
  }

  return (
    <>
      <ConfigurableDrawer
        title={`Audit Results - ${location.name}`}
        description="Review scanned assets and resolve discrepancies"
        className={className}
        style={style}
        defaultExpanded={hasResults}
        actionButtons={
          <div className="flex gap-2">
            <Form method="post">
              <input type="hidden" name="intent" value="cancel-audit" />
              <input type="hidden" name="auditSessionId" value={auditSession.id} />
              <Button
                variant="secondary"
                type="submit"
                disabled={disabled}
                onClick={handleCancelAudit}
              >
                Cancel Audit
              </Button>
            </Form>
            <Button
              disabled={disabled || found.length === 0}
              onClick={handleCompleteAudit}
            >
              Complete Audit
            </Button>
          </div>
        }
      >
        <div className="space-y-6">
          {/* Audit Session Header */}
          <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
            <h3 className="font-medium text-blue-900">Audit Session</h3>
            <div className="grid grid-cols-2 gap-4 mt-2 text-sm">
              <div>
                <span className="text-blue-700">Expected:</span> 
                <span className="font-medium ml-1">{auditSession.expectedAssetCount}</span>
              </div>
              <div>
                <span className="text-blue-700">Found:</span> 
                <span className="font-medium ml-1">{found.length}</span>
              </div>
            </div>
          </div>

          {/* Blockers */}
          {hasBlockers && <Blockers />}

          {/* Found Assets */}
          {found.length > 0 && (
            <section>
              <h3 className="flex items-center gap-2 text-green-800 font-medium mb-3">
                <CheckmarkIcon className="w-4 h-4" />
                Found ({found.length})
              </h3>
              <div className="space-y-2">
                {found.map((asset) => (
                  <GenericItemRow
                    key={asset.id}
                    title={asset.name}
                    subTitle="Found in expected location"
                    className="border-green-200 bg-green-50"
                  />
                ))}
              </div>
            </section>
          )}

          {/* Missing Assets */}
          {missing.length > 0 && (
            <section>
              <h3 className="flex items-center gap-2 text-yellow-800 font-medium mb-3">
                <span className="w-4 h-4 rounded-full bg-yellow-500 flex items-center justify-center text-white text-xs">!</span>
                Missing ({missing.length})
              </h3>
              <div className="space-y-2">
                {missing.map((asset) => (
                  <GenericItemRow
                    key={asset.id}
                    title={asset.name}
                    subTitle="Not found during scan"
                    className="border-yellow-200 bg-yellow-50"
                  />
                ))}
              </div>
              {missing.length > 0 && (
                <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <p className="text-sm text-yellow-800">
                    These assets were expected but not scanned. They may have been moved or misplaced.
                  </p>
                </div>
              )}
            </section>
          )}

          {/* Unexpected Assets */}
          {unexpected.length > 0 && (
            <section>
              <h3 className="flex items-center gap-2 text-red-800 font-medium mb-3">
                <span className="w-4 h-4 rounded-full bg-red-500 flex items-center justify-center text-white text-xs">×</span>
                Unexpected ({unexpected.length})
              </h3>
              <div className="space-y-2">
                {unexpected.map((asset) => (
                  <GenericItemRow
                    key={asset.id}
                    title={asset.name}
                    subTitle="Not expected in this location"
                    className="border-red-200 bg-red-50"
                  />
                ))}
              </div>
              {unexpected.length > 0 && (
                <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-800">
                    These assets were scanned but don't belong in this location according to records.
                  </p>
                </div>
              )}
            </section>
          )}

          {/* No Results State */}
          {!hasResults && (
            <div className="text-center py-8 text-gray-500">
              <p>No assets scanned yet.</p>
              <p className="text-sm mt-1">Start scanning to see results here.</p>
            </div>
          )}
        </div>
      </ConfigurableDrawer>

      {/* Completion Confirmation Dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Complete Audit</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to complete this audit? This will finalize the audit session.
              <div className="mt-3 space-y-1 text-sm">
                <div>Found: <strong>{found.length}</strong> assets</div>
                <div>Missing: <strong>{missing.length}</strong> assets</div>
                <div>Unexpected: <strong>{unexpected.length}</strong> assets</div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Form method="post">
              <input type="hidden" name="intent" value="complete-audit" />
              <input type="hidden" name="auditSessionId" value={auditSession?.id} />
              <input type="hidden" name="foundAssetCount" value={found.length} />
              <input type="hidden" name="missingAssetCount" value={missing.length} />
              <input type="hidden" name="unexpectedAssetCount" value={unexpected.length} />
              <Button type="submit">
                Complete Audit
              </Button>
            </Form>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}