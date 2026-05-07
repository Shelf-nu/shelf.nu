import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "./auth-context";
import { api, type Organization } from "./api";

const SELECTED_ORG_KEY = "shelf_selected_org_id";

/** User profile data returned by the /me endpoint */
export type UserProfile = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  profilePicture: string | null;
};

type OrgState = {
  organizations: Organization[];
  currentOrg: Organization | null;
  setCurrentOrg: (org: Organization) => void;
  userProfile: UserProfile | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

const OrgContext = createContext<OrgState | undefined>(undefined);

export function OrgProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [currentOrg, setCurrentOrg] = useState<Organization | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Persist selected org when it changes
  const handleSetCurrentOrg = useCallback((org: Organization) => {
    setCurrentOrg(org);
    AsyncStorage.setItem(SELECTED_ORG_KEY, org.id).catch(() => {});
  }, []);

  const fetchOrgs = useCallback(async () => {
    if (!user) {
      setOrganizations([]);
      setCurrentOrg(null);
      setUserProfile(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    const { data, error: fetchError } = await api.me();

    if (fetchError || !data) {
      setError(fetchError || "Failed to load workspace data");
      setIsLoading(false);
      return;
    }

    // Store user profile
    setUserProfile(data.user);

    const orgs = data.organizations;
    setOrganizations(orgs);

    // Try to restore previously selected org from storage
    let savedOrgId: string | null = null;
    try {
      savedOrgId = await AsyncStorage.getItem(SELECTED_ORG_KEY);
    } catch {}

    // Preserve current selection if still valid
    if (currentOrg) {
      const stillExists = orgs.find((o) => o.id === currentOrg.id);
      if (!stillExists && orgs.length > 0) {
        const restoredOrg = savedOrgId
          ? orgs.find((o) => o.id === savedOrgId)
          : null;
        handleSetCurrentOrg(restoredOrg || orgs[0]);
      }
    } else if (orgs.length > 0) {
      // First load — try restoring from storage, otherwise pick first
      const restoredOrg = savedOrgId
        ? orgs.find((o) => o.id === savedOrgId)
        : null;
      handleSetCurrentOrg(restoredOrg || orgs[0]);
    }

    setIsLoading(false);
  }, [user]);

  useEffect(() => {
    fetchOrgs();
  }, [fetchOrgs]);

  const value = useMemo(
    () => ({
      organizations,
      currentOrg,
      setCurrentOrg: handleSetCurrentOrg,
      userProfile,
      isLoading,
      error,
      refresh: fetchOrgs,
    }),
    [
      organizations,
      currentOrg,
      handleSetCurrentOrg,
      userProfile,
      isLoading,
      error,
      fetchOrgs,
    ]
  );

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg() {
  const context = useContext(OrgContext);
  if (!context) {
    throw new Error("useOrg must be used within OrgProvider");
  }
  return context;
}

export type { Organization };
