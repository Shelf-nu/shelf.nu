/**
 * Admin: SSO conversion
 *
 * Lets Shelf staff convert a customer's existing standard (email/password)
 * accounts into SSO-only accounts that keep their original UUID and all data.
 * Staff enter an email domain to list every matching Shelf account, annotated
 * with whether it is already SSO or belongs to a workspace owner (and therefore
 * ineligible), then convert eligible accounts one at a time.
 *
 * The page also lists the workspaces that claim the domain and flags the ones
 * with SSO group mappings: at a converted user's first SSO login, membership in
 * those workspaces is re-derived from the user's IdP groups, so a user whose
 * groups map to no role loses access there.
 *
 * Conversion is delegated to {@link convertAccountToSso}; the candidate list and
 * eligibility annotations come from {@link findEligibleAccountsForSsoConversion}.
 * The page is gated to ADMIN users in both the loader and the action.
 *
 * @see {@link file://./../../../modules/auth/sso-conversion.server.ts}
 * @see {@link file://./../../../utils/sso.server.ts} checkDomainSSOStatus
 * @see {@link file://./../../../modules/user/service.server.ts} reconcileSsoGroupMembership
 */
import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useFetcher, useLoaderData } from "react-router";
import { z } from "zod";
import { Form } from "~/components/custom-form";
import Input from "~/components/forms/input";
import { Button } from "~/components/shared/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/shared/modal";
import { Table, Td, Th, Tr } from "~/components/table";
import { useDisabled } from "~/hooks/use-disabled";
import type { SsoConversionCandidate } from "~/modules/auth/sso-conversion.server";
import {
  convertAccountToSso,
  findEligibleAccountsForSsoConversion,
} from "~/modules/auth/sso-conversion.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { payload, error, parseData } from "~/utils/http.server";
import { requireAdmin } from "~/utils/roles.server";
import { checkDomainSSOStatus } from "~/utils/sso.server";
import { resolveUserDisplayName } from "~/utils/user";

export const meta = () => [{ title: appendToMetaTitle("SSO conversion") }];

export const handle = {
  breadcrumb: () => "SSO conversion",
};

/** A workspace that claims the searched domain in its SSO details. */
type LinkedWorkspace = {
  id: string;
  name: string;
  /**
   * True when any IdP group is mapped to a role. Membership in such a workspace
   * is re-derived from the user's IdP groups at every SSO login.
   */
  hasGroupMappings: boolean;
};

/**
 * Loads the SSO conversion view for an optional `?domain=` query.
 *
 * With no `domain` the page renders an empty search form. With a `domain` it
 * resolves whether that domain has an SSO provider configured (via a sample
 * address `x@<domain>`), which workspaces claim it and whether they map IdP
 * groups to roles, and lists every Shelf account on the domain together with
 * its conversion eligibility.
 *
 * @throws A `data` error response when the caller is not an admin (403)
 */
export async function loader({ context, request }: LoaderFunctionArgs) {
  const { userId } = context.getSession();

  try {
    await requireAdmin(userId);

    const url = new URL(request.url);
    // Accept "acme.com" as well as "@acme.com", in any case.
    const domain = (url.searchParams.get("domain") ?? "")
      .trim()
      .replace(/^@/, "")
      .toLowerCase();

    if (!domain) {
      return payload({
        domain: "",
        isConfiguredForSSO: false,
        candidates: [] as SsoConversionCandidate[],
        linkedWorkspaces: [] as LinkedWorkspace[],
      });
    }

    // Only the domain part of the address is consulted, so the local part is
    // a placeholder.
    const { isConfiguredForSSO, linkedOrganizations } =
      await checkDomainSSOStatus(`x@${domain}`);
    const candidates = await findEligibleAccountsForSsoConversion(domain);

    const linkedWorkspaces: LinkedWorkspace[] = linkedOrganizations.map(
      (org) => ({
        id: org.id,
        name: org.name,
        hasGroupMappings: Boolean(
          org.ssoDetails?.adminGroupId ||
            org.ssoDetails?.selfServiceGroupId ||
            org.ssoDetails?.baseUserGroupId
        ),
      })
    );

    return payload({
      domain,
      isConfiguredForSSO,
      candidates,
      linkedWorkspaces,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

/**
 * Converts a single account to SSO. Parses `targetUserId` from the submitted
 * form and delegates to {@link convertAccountToSso}, which enforces the
 * eligibility guards (workspace owner, already SSO, domain not configured).
 *
 * @returns A `payload` with the conversion result on success, or an `error`
 *   response carrying the failure status
 */
export async function action({ context, request }: ActionFunctionArgs) {
  const { userId } = context.getSession();

  try {
    await requireAdmin(userId);

    const { targetUserId } = parseData(
      await request.formData(),
      z.object({ targetUserId: z.string().min(1) })
    );

    // `userId` is the admin performing the conversion; `targetUserId` is the
    // account being converted.
    const result = await convertAccountToSso({
      userId: targetUserId,
      actorUserId: userId,
    });

    sendNotification({
      title:
        result.status === "converted"
          ? "Account converted to SSO"
          : "Account already SSO",
      message:
        result.status === "converted"
          ? `${result.email} can now sign in via SSO.`
          : `${result.email} was already an SSO account.`,
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    return payload({ result });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}

export default function SsoConversionPage() {
  const { domain, isConfiguredForSSO, candidates, linkedWorkspaces } =
    useLoaderData<typeof loader>();
  const mappedWorkspaces = linkedWorkspaces.filter((w) => w.hasGroupMappings);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <h1 className="text-xl font-semibold">Convert accounts to SSO</h1>
        <p className="text-sm text-gray-600">
          Enter an email domain to list its Shelf accounts. Eligible accounts
          can be converted to SSO-only sign-in while keeping all of their data.
          Workspace owners and accounts that are already SSO cannot be
          converted.
        </p>
      </div>

      {/* A GET form, so the domain lives in the URL and the page can be
          refreshed or shared. */}
      <Form method="get" className="flex items-end gap-2">
        <Input
          label="Email domain"
          name="domain"
          defaultValue={domain}
          placeholder="acme.com"
          className="w-64"
          autoComplete="off"
        />
        <Button type="submit">Search</Button>
      </Form>

      {domain && !isConfiguredForSSO ? (
        <p className="text-sm text-error-500" role="alert">
          Domain <strong>{domain}</strong> has no SSO provider configured. Set
          up the provider for this domain before converting accounts.
        </p>
      ) : null}

      {domain && isConfiguredForSSO ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-gray-900">
            Workspaces linked to {domain}
          </h2>
          {linkedWorkspaces.length > 0 ? (
            <ul className="list-inside list-disc text-sm text-gray-700">
              {linkedWorkspaces.map((workspace) => (
                <li key={workspace.id}>
                  {workspace.name}
                  {workspace.hasGroupMappings
                    ? " (group mappings set)"
                    : " (no group mappings)"}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-600">
              No workspace claims this domain. Existing memberships stay as they
              are.
            </p>
          )}

          {mappedWorkspaces.length > 0 ? (
            // why: a plain box rather than WarningBox, which can be dismissed.
            // This is the page's only signal that conversion can cost a user
            // their workspace access, so it stays visible on every search.
            <div
              role="status"
              className="rounded border border-warning-300 bg-warning-25 p-4 text-sm text-warning-700"
            >
              <div>
                <p className="font-semibold">
                  Check group mappings before converting
                </p>
                <p>
                  {mappedWorkspaces.map((w) => w.name).join(", ")}{" "}
                  {mappedWorkspaces.length === 1 ? "maps" : "map"} IdP groups to
                  roles. At a converted user's first SSO login, their access to{" "}
                  {mappedWorkspaces.length === 1
                    ? "that workspace"
                    : "those workspaces"}{" "}
                  is re-derived from their IdP groups. A user whose groups map
                  to no role loses access there.
                </p>
              </div>
            </div>
          ) : linkedWorkspaces.length > 0 ? (
            <p className="text-sm text-gray-600">
              None of these workspaces map IdP groups to roles, so converted
              users keep their existing memberships.
            </p>
          ) : null}
        </div>
      ) : null}

      {candidates.length > 0 ? (
        <Table>
          <thead>
            <Tr>
              <Th>Email</Th>
              <Th>Name</Th>
              <Th>Status</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </Tr>
          </thead>
          <tbody>
            {candidates.map((candidate) => (
              <CandidateRow key={candidate.id} candidate={candidate} />
            ))}
          </tbody>
        </Table>
      ) : domain && isConfiguredForSSO ? (
        <p className="text-sm text-gray-600">No accounts found for {domain}.</p>
      ) : null}
    </div>
  );
}

/**
 * One candidate account row: name, eligibility status and a Convert action
 * behind a confirmation dialog.
 *
 * Each row owns its fetcher, so an in-flight conversion only disables its own
 * button, and the row shows its own result or error (a page-level
 * `useActionData` never sees fetcher submissions).
 *
 * @param props.candidate - The eligibility-annotated account to render
 */
function CandidateRow({ candidate }: { candidate: SsoConversionCandidate }) {
  const fetcher = useFetcher<typeof action>();
  const submitting = useDisabled(fetcher);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const ineligible = candidate.ownsTeamOrg || candidate.alreadySso;
  const status = candidate.alreadySso
    ? "Already SSO"
    : candidate.ownsTeamOrg
    ? "Workspace owner, cannot convert"
    : "Eligible";

  const fetcherError = fetcher.data?.error ?? null;
  const result =
    fetcher.data && "result" in fetcher.data ? fetcher.data.result : null;

  return (
    <Tr>
      <Td>{candidate.email}</Td>
      <Td>{resolveUserDisplayName(candidate)}</Td>
      <Td>
        <div className="flex flex-col gap-1">
          <span>{status}</span>
          {fetcherError ? (
            <span className="text-xs text-error-500" role="alert">
              {fetcherError.message}
            </span>
          ) : result ? (
            <span className="text-xs text-success-600" role="status">
              {result.status === "converted"
                ? "Converted to SSO."
                : "Was already an SSO account."}
            </span>
          ) : null}
        </div>
      </Td>
      <Td className="text-right">
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogTrigger asChild>
            <Button type="button" size="sm" disabled={ineligible || submitting}>
              {submitting ? "Converting..." : "Convert"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Convert {candidate.email} to SSO?
              </AlertDialogTitle>
              <AlertDialogDescription>
                This removes the account's password and signs it out of every
                session. From then on it can only sign in through the domain's
                SSO provider. The account keeps its data and user id.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel asChild>
                <Button type="button" variant="secondary" disabled={submitting}>
                  Cancel
                </Button>
              </AlertDialogCancel>
              <fetcher.Form
                method="post"
                onSubmit={() => setConfirmOpen(false)}
              >
                <input type="hidden" name="targetUserId" value={candidate.id} />
                <Button type="submit" disabled={submitting}>
                  Convert to SSO
                </Button>
              </fetcher.Form>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Td>
    </Tr>
  );
}
