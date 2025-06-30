import { useCurrentOrganization } from "~/hooks/use-current-organization";

/**
 * Hook to check if barcodes are enabled for the current organization
 */
export function useBarcodePermissions() {
  const currentOrganization = useCurrentOrganization();

  return {
    /**
     * Whether barcodes are enabled for the current organization
     */
    barcodesEnabled: currentOrganization?.barcodesEnabled ?? false,
    
    /**
     * Whether the user can use barcode features
     * For now this is the same as barcodesEnabled, but can be extended
     * with tier checks, user role checks, etc.
     */
    canUseBarcodes: currentOrganization?.barcodesEnabled ?? false,
  };
}