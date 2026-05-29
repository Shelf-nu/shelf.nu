import { apiFetch, apiUpload } from "./client";
import type {
  AuditsResponse,
  AuditDetailResponse,
  RecordScanResponse,
  CompleteAuditResponse,
  CreateAuditNoteResponse,
  UploadAuditImageResponse,
} from "./types";

export const auditsApi = {
  /**
   * Get paginated audits for an organization.
   *
   * Results are always sorted server-side by
   * `(dueDate asc nulls last, createdAt desc)` so overdue + soon-due
   * work surfaces first; the companion does not expose a sort UI.
   *
   * @param orgId Active organization id from `useOrg`.
   * @param params Optional filters / pagination:
   *   - `status` — comma-separated `AuditStatus` values (e.g. `"PENDING,ACTIVE"`).
   *   - `page` / `perPage` — pagination knobs.
   *   - `search` — free-text search over name / description.
   *   - `assignedToMe` — when `true`, restricts the result to audits
   *     the caller is assigned to. For BASE/SELF_SERVICE users this is
   *     already implicit server-side; for admins/owners it's the
   *     companion's "Assigned to me" toggle.
   * @param signal AbortSignal for in-flight cancellation on rapid
   *   filter toggling (the list re-fires on every chip tap; aborting
   *   the previous request stops a slow earlier response from
   *   overwriting the latest state).
   * @returns The `apiFetch` envelope `{ data, error }` carrying an
   *   `AuditsResponse` payload on success.
   * @throws Never — `apiFetch` returns network / parse / HTTP errors
   *   inside the envelope's `error` field instead of throwing, so
   *   callers branch on the envelope rather than try/catch.
   */
  audits: (
    orgId: string,
    params?: {
      status?: string;
      page?: number;
      perPage?: number;
      search?: string;
      assignedToMe?: boolean;
    },
    signal?: AbortSignal
  ) => {
    const searchParams = new URLSearchParams({ orgId });
    if (params?.status) searchParams.set("status", params.status);
    if (params?.page) searchParams.set("page", String(params.page));
    if (params?.perPage) searchParams.set("perPage", String(params.perPage));
    if (params?.search) searchParams.set("search", params.search);
    if (params?.assignedToMe) searchParams.set("assignedToMe", "true");
    return apiFetch<AuditsResponse>(`/api/mobile/audits?${searchParams}`, {
      signal,
    });
  },

  /** Get full audit detail with expected assets and existing scans */
  audit: (auditId: string, orgId: string) =>
    apiFetch<AuditDetailResponse>(
      `/api/mobile/audits/${auditId}?orgId=${orgId}`
    ),

  /** Record a scan during an audit (idempotent) */
  recordAuditScan: (
    orgId: string,
    payload: {
      auditSessionId: string;
      qrId: string;
      assetId: string;
      isExpected: boolean;
    }
  ) =>
    apiFetch<RecordScanResponse>(
      `/api/mobile/audits/record-scan?orgId=${orgId}`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    ),

  /** Complete an audit session */
  completeAudit: (
    orgId: string,
    payload: {
      sessionId: string;
      completionNote?: string;
      timeZone?: string;
    }
  ) =>
    apiFetch<CompleteAuditResponse>(
      `/api/mobile/audits/complete?orgId=${orgId}`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    ),

  /**
   * Create a condition note for a scanned asset within an audit.
   *
   * This is the per-scan evidence that shows in the audit PDF report.
   * The note is tied to a specific `auditAssetId` (the scan record),
   * not directly to the asset itself.
   *
   * @param orgId Active organization ID
   * @param payload.auditSessionId The audit session ID
   * @param payload.auditAssetId The audit-asset record ID (from scan)
   * @param payload.content Note text (1-5000 chars, trimmed)
   */
  createNote: (
    orgId: string,
    payload: {
      auditSessionId: string;
      auditAssetId: string;
      content: string;
    }
  ) =>
    apiFetch<CreateAuditNoteResponse>(
      `/api/mobile/audits/note?orgId=${orgId}`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    ),

  /**
   * Upload a condition photo for a scanned asset within an audit.
   *
   * Photos are auto-resized to 1200px max and a 108px thumbnail is
   * generated server-side. Max file size is 4MB.
   *
   * @param orgId Active organization ID
   * @param auditSessionId The audit session ID
   * @param auditAssetId The audit-asset record ID (from scan)
   * @param imageUri Local file URI from expo-image-picker
   * @param mimeType Image MIME type (defaults to image/jpeg)
   * @param content Optional note text to accompany the image
   */
  uploadImage: (
    orgId: string,
    auditSessionId: string,
    auditAssetId: string,
    imageUri: string,
    mimeType: string = "image/jpeg",
    content?: string
  ) => {
    const formData = new FormData();
    // React Native FormData accepts objects with uri/type/name for file uploads
    formData.append("image", {
      uri: imageUri,
      type: mimeType,
      name: `audit-photo.${mimeType === "image/png" ? "png" : "jpg"}`,
    } as any);

    if (content) {
      formData.append("content", content);
    }

    const params = new URLSearchParams({
      orgId,
      auditSessionId,
      auditAssetId,
    });

    return apiUpload<UploadAuditImageResponse>(
      `/api/mobile/audits/image?${params}`,
      formData
    );
  },
};
