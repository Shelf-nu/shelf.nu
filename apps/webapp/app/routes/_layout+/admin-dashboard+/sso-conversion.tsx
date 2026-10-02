/**
 * Admin: SSO conversion
 *
 * Lets Shelf staff convert a customer's existing standard (email/password)
 * accounts into SSO-only accounts that keep their original UUID and all data.
 * Staff enter an email domain to list every matching Shelf account, annotated
 * with whether it is already SSO or belongs to an owner of the workspace that
 * uses SSO for the domain, then either convert accounts one at a time or
 * convert every eligible account at once. "Convert all" skips those owners,
 * who may keep password login; each can still be converted individually.
 * Owning any other workspace earns no exemption. Accounts whose user tried SSO
 * before conversion are flagged: their first SSO sign-in after conversion asks
 * them to sign in once more.
 *
 * Already-SSO accounts can be reverted to standard login as a recovery tool,
 * for example when a customer's identity provider is unavailable. A revert is
 * only allowed when the account could then sign in with a password: an owner of
 * the workspace that uses SSO for the domain, or any account whose domain no
 * longer uses SSO.
 *
 * The page also lists the workspaces that claim the domain and flags the ones
 * with SSO group mappings: at a converted user's first SSO login, membership in
 * those workspaces is re-derived from the user's IdP groups, so a user whose
 * groups map to no role loses access there.
 *
 * The action dispatches on an `intent` field (`convert-one`, `convert-all`,
 * `revert`) to {@link convertAccountToSso}, {@link convertAllEligibleOnDomain}
 * and {@link revertAccountToStandard}, which enforce every eligibility rule;
 * the candidate list comes from {@link findEligibleAccountsForSsoConversion}.
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
import type {
  SsoConversionCandidate,
  SsoConversionResult,
  SsoConvertAllResult,
  SsoRevertResult,
} from "~/modules/auth/sso-conversion.server";
import {
  convertAccountToSso,
  convertAllEligibleOnDomain,
  findEligibleAccountsForSsoConversion,
  revertAccountToStandard,
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
 * The action's form contract, one branch per `intent`. An unknown or missing
 * intent fails validation with a 400.
 */
const SsoConversionActionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("convert-one"),
    targetUserId: z.string().min(1),
  }),
  z.object({
    intent: z.literal("convert-all"),
    domain: z.string().trim().min(1),
  }),
  z.object({
    intent: z.literal("revert"),
    targetUserId: z.string().min(1),
  }),
]);

/**
 * Runs one SSO conversion operation, selected by the submitted `intent`:
 *
 * - `convert-one`: converts `targetUserId` via {@link convertAccountToSso}
 *   (owners included);
 * - `convert-all`: converts every eligible account on `domain` via
 *   {@link convertAllEligibleOnDomain}, which recomputes eligibility itself and
 *   skips owners and SSO accounts;
 * - `revert`: reverts `targetUserId` to standard login via
 *   {@link revertAccountToStandard}.
 *
 * The admin check runs before the form is read, for every intent. The engine
 * functions enforce the eligibility rules; their refusals come back with the
 * engine's status.
 *
 * @returns A `payload` carrying the `intent` and its result, so the client can
 *   narrow on `intent`, or an `error` response carrying the failure status
 */
export async function action({ context, request }: ActionFunctionArgs) {
  const { userId } = context.getSession();

  try {
    await requireAdmin(userId);

    const submission = parseData(
      await request.formData(),
      SsoConversionActionSchema
    );

    // Throughout, `userId` is the admin performing the operation and
    // `targetUserId` is the account being changed.
    switch (submission.intent) {
      case "convert-one": {
        const result = await convertAccountToSso({
          userId: submission.targetUserId,
          actorUserId: userId,
        });

        const copy = describeConversionResult(result);
        sendNotification({
          title: copy.title,
          message: copy.message,
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        return payload({ intent: "convert-one" as const, result });
      }

      case "convert-all": {
        const result = await convertAllEligibleOnDomain({
          domain: submission.domain,
          actorUserId: userId,
        });

        const copy = describeConvertAllResult(result);
        sendNotification({
          title: copy.title,
          message: copy.message,
          icon:
            result.failed.length > 0
              ? { name: "x", variant: "error" }
              : { name: "success", variant: "success" },
          senderId: userId,
        });

        return payload({ intent: "convert-all" as const, result });
      }

      case "revert": {
        const result = await revertAccountToStandard({
          userId: submission.targetUserId,
          actorUserId: userId,
        });

        const copy = describeRevertResult(result);
        sendNotification({
          title: copy.title,
          message: copy.message,
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        return payload({ intent: "revert" as const, result });
      }
    }
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}

/**
 * User-facing copy for one conversion result, shared by the toast the action
 * sends and the line under the converted row.
 *
 * @param result - the outcome of {@link convertAccountToSso}
 * @returns the toast title and message, and the short text for the row
 */
function describeConversionResult(result: SsoConversionResult): {
  title: string;
  message: string;
  rowText: string;
} {
  switch (result.status) {
    case "converted":
      return result.needsExtraSignIn
        ? {
            title: "Account converted to SSO",
            message: `${result.email} can now sign in via SSO. They tried SSO before conversion, so their first SSO sign-in will ask them to sign in once more.`,
            rowText:
              "Converted to SSO. Their first SSO sign-in will ask them to sign in once more.",
          }
        : {
            title: "Account converted to SSO",
            message: `${result.email} can now sign in via SSO.`,
            rowText: "Converted to SSO.",
          };
    case "skipped_already_sso":
      return {
        title: "Account already SSO",
        message: `${result.email} was already an SSO account.`,
        rowText: "Was already an SSO account.",
      };
    case "skipped_owner":
      return {
        title: "Account not converted",
        message: `${result.email} owns the workspace that uses SSO and keeps password login.`,
        rowText: "Workspace owner, not converted.",
      };
  }
}

/**
 * Toast copy for a "Convert all" run. The per-account failures are listed on
 * the page itself, so the toast only carries the counts.
 *
 * @param result - the outcome of {@link convertAllEligibleOnDomain}
 * @returns the toast title and message
 */
function describeConvertAllResult(result: SsoConvertAllResult): {
  title: string;
  message: string;
} {
  const converted = pluralizeAccounts(result.converted);
  const failed = result.failed.length;
  const baseOutcome =
    failed > 0
      ? "See the summary on the page for the accounts that failed."
      : "Every eligible account on the domain now signs in via SSO.";
  // Accounts that became an owner of the SSO workspace during the run.
  const outcome =
    result.skippedOwners > 0
      ? `${baseOutcome} ${pluralizeAccounts(
          result.skippedOwners
        )} now owning the SSO workspace kept password login.`
      : baseOutcome;

  return {
    title:
      failed > 0
        ? `Converted ${converted}, ${failed} failed`
        : `Converted ${converted} to SSO`,
    message:
      result.needsExtraSignIn > 0
        ? `${outcome} ${describeExtraSignIns(result.needsExtraSignIn)}`
        : outcome,
  };
}

/**
 * The sentence telling the admin how many converted users will be asked to sign
 * in once more, shared by the Convert all toast and summary.
 *
 * @param count - converted accounts whose user tried SSO before conversion
 */
function describeExtraSignIns(count: number) {
  return count === 1
    ? "1 account tried SSO before conversion: its first SSO sign-in will ask the user to sign in once more."
    : `${count} accounts tried SSO before conversion: their first SSO sign-in will ask the users to sign in once more.`;
}

/**
 * User-facing copy for a revert, shared by the toast the action sends and the
 * line under the reverted row.
 *
 * @param result - the outcome of {@link revertAccountToStandard}
 * @returns the toast title and message, and the short text for the row
 */
function describeRevertResult(result: SsoRevertResult): {
  title: string;
  message: string;
  rowText: string;
} {
  return {
    title: "Account reverted to standard login",
    message: `${result.email} was signed out and can set a password with Forgot password.`,
    rowText: "Reverted. They set a password with Forgot password.",
  };
}

/**
 * "1 account" / "3 accounts".
 *
 * @param count - the number of accounts
 */
function pluralizeAccounts(count: number) {
  return `${count} ${count === 1 ? "account" : "accounts"}`;
}

export default function SsoConversionPage() {
  const { domain, isConfiguredForSSO, candidates, linkedWorkspaces } =
    useLoaderData<typeof loader>();
  const mappedWorkspaces = linkedWorkspaces.filter((w) => w.hasGroupMappings);
  // Mirrors the server's own selection in convertAllEligibleOnDomain, which is
  // what actually decides; this count only labels the button.
  const eligibleCount = candidates.filter(
    (c) => !c.alreadySso && !c.ownsSsoWorkspace
  ).length;

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <h1 className="text-xl font-semibold">Convert accounts to SSO</h1>
        <p className="text-sm text-gray-600">
          Enter an email domain to list its Shelf accounts. Converted accounts
          sign in only via SSO and keep all of their data. Owners of the
          workspace that uses SSO for the domain can keep password login:
          Convert all skips them, but each one can still be converted on its
          own. Owning any other workspace does not exempt an account. SSO
          accounts can be reverted to standard login when that would let them
          sign in with a password.
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
        <>
          <ConvertAllControl
            domain={domain}
            eligibleCount={eligibleCount}
            isConfiguredForSSO={isConfiguredForSSO}
          />
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
                <CandidateRow
                  key={candidate.id}
                  candidate={candidate}
                  domain={domain}
                  isConfiguredForSSO={isConfiguredForSSO}
                />
              ))}
            </tbody>
          </Table>
        </>
      ) : domain && isConfiguredForSSO ? (
        <p className="text-sm text-gray-600">No accounts found for {domain}.</p>
      ) : null}
    </div>
  );
}

/**
 * The "Convert all eligible (N)" button, its confirmation dialog, and the
 * summary of the last run.
 *
 * It owns its fetcher so the run's summary survives the loader revalidation
 * that follows the submission (which refreshes the rows below). The server
 * recomputes which accounts are eligible; `eligibleCount` only labels the
 * button and the confirmation.
 *
 * @param props.domain - the searched domain, submitted with the form
 * @param props.eligibleCount - accounts that are neither SSO nor owners
 * @param props.isConfiguredForSSO - whether the domain has an SSO provider
 */
function ConvertAllControl({
  domain,
  eligibleCount,
  isConfiguredForSSO,
}: {
  domain: string;
  eligibleCount: number;
  isConfiguredForSSO: boolean;
}) {
  const fetcher = useFetcher<typeof action>();
  const submitting = useDisabled(fetcher);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const fetcherError = fetcher.data?.error ?? null;
  const summary =
    fetcher.data &&
    "intent" in fetcher.data &&
    fetcher.data.intent === "convert-all"
      ? fetcher.data.result
      : null;

  return (
    <div className="flex flex-col gap-2">
      <div>
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              disabled={
                !isConfiguredForSSO || eligibleCount === 0 || submitting
              }
            >
              {submitting
                ? "Converting..."
                : `Convert all eligible (${eligibleCount})`}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Convert {pluralizeAccounts(eligibleCount)} on {domain} to SSO?
              </AlertDialogTitle>
              <AlertDialogDescription>
                {eligibleCount === 1 ? "This account" : "These accounts"} will
                lose password login and be signed out of every session. From
                then on they can only sign in through the domain's SSO provider,
                and they keep their data and user id. Owners of the workspace
                that uses SSO for this domain are skipped and keep their
                password login.
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
                <input type="hidden" name="intent" value="convert-all" />
                <input type="hidden" name="domain" value={domain} />
                <Button type="submit" disabled={submitting}>
                  Convert all
                </Button>
              </fetcher.Form>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {fetcherError ? (
        <p className="text-sm text-error-500" role="alert">
          {fetcherError.message}
        </p>
      ) : summary ? (
        <ConvertAllSummary summary={summary} />
      ) : null}
    </div>
  );
}

/**
 * The outcome of a "Convert all" run: how many converted, how many of those
 * will be asked to sign in once more, and every account that failed with its
 * reason.
 *
 * @param props.summary - the result of {@link convertAllEligibleOnDomain}
 */
function ConvertAllSummary({ summary }: { summary: SsoConvertAllResult }) {
  return (
    <div role="status" className="flex flex-col gap-1 text-sm text-gray-700">
      <p className="font-semibold text-gray-900">
        Converted {pluralizeAccounts(summary.converted)}.
      </p>
      {summary.needsExtraSignIn > 0 ? (
        <p className="text-warning-700">
          {describeExtraSignIns(summary.needsExtraSignIn)}
        </p>
      ) : null}
      {summary.skippedOwners > 0 ? (
        <p>
          Skipped {pluralizeAccounts(summary.skippedOwners)} that now own the
          workspace that uses SSO: they keep password login.
        </p>
      ) : null}
      {summary.failed.length > 0 ? (
        <div className="text-error-500">
          <p className="font-semibold">
            {pluralizeAccounts(summary.failed.length)} could not be converted:
          </p>
          <ul className="list-inside list-disc">
            {summary.failed.map((failure) => (
              <li key={failure.userId}>
                {failure.email}: {failure.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * One candidate account row: name, status and a single action behind a
 * confirmation dialog. A standard account whose user tried SSO before
 * conversion carries a note that their first SSO sign-in will ask them to sign
 * in once more. A standard account offers Convert (with owner-specific
 * wording for owners of the workspace that uses SSO for the domain); an SSO
 * account offers Revert to standard.
 *
 * Each row owns its fetcher, so an in-flight operation only disables its own
 * button, and the row shows its own result or error (a page-level
 * `useActionData` never sees fetcher submissions).
 *
 * @param props.candidate - The eligibility-annotated account to render
 * @param props.domain - The searched domain, for the revert explanation
 * @param props.isConfiguredForSSO - Whether the domain has an SSO provider
 */
function CandidateRow({
  candidate,
  domain,
  isConfiguredForSSO,
}: {
  candidate: SsoConversionCandidate;
  domain: string;
  isConfiguredForSSO: boolean;
}) {
  const fetcher = useFetcher<typeof action>();
  const submitting = useDisabled(fetcher);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const status = candidate.alreadySso
    ? candidate.ownsSsoWorkspace
      ? "Already SSO (workspace owner)"
      : "Already SSO"
    : candidate.ownsSsoWorkspace
    ? "Workspace owner, can keep password login"
    : "Eligible";

  const fetcherError = fetcher.data?.error ?? null;
  const resultText =
    fetcher.data && "intent" in fetcher.data
      ? fetcher.data.intent === "convert-one"
        ? describeConversionResult(fetcher.data.result).rowText
        : fetcher.data.intent === "revert"
        ? describeRevertResult(fetcher.data.result).rowText
        : null
      : null;

  return (
    <Tr>
      <Td>{candidate.email}</Td>
      <Td>{resolveUserDisplayName(candidate)}</Td>
      <Td>
        <div className="flex flex-col gap-1">
          <span>{status}</span>
          {!candidate.alreadySso && candidate.hasEarlierSsoLogin ? (
            <span className="max-w-xs text-xs text-warning-700">
              Tried SSO before conversion: their first SSO sign-in will ask them
              to sign in once more.
            </span>
          ) : null}
          {fetcherError ? (
            <span className="text-xs text-error-500" role="alert">
              {fetcherError.message}
            </span>
          ) : resultText ? (
            <span className="text-xs text-success-600" role="status">
              {resultText}
            </span>
          ) : null}
        </div>
      </Td>
      <Td className="text-right">
        {candidate.alreadySso ? (
          <RevertAction
            candidate={candidate}
            domain={domain}
            isConfiguredForSSO={isConfiguredForSSO}
            fetcher={fetcher}
            submitting={submitting}
            confirmOpen={confirmOpen}
            setConfirmOpen={setConfirmOpen}
          />
        ) : (
          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                size="sm"
                disabled={!isConfiguredForSSO || submitting}
              >
                {submitting ? "Converting..." : "Convert"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Convert {candidate.email} to SSO?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {candidate.ownsSsoWorkspace
                    ? "This account owns the workspace that uses SSO for this domain and could keep password login. After conversion it can only sign in via SSO, and it is signed out of every session. If the identity provider becomes unavailable, Shelf support can revert it to standard login. The account keeps its data and user id."
                    : "This removes the account's password and signs it out of every session. From then on it can only sign in through the domain's SSO provider. The account keeps its data and user id."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel asChild>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={submitting}
                  >
                    Cancel
                  </Button>
                </AlertDialogCancel>
                <fetcher.Form
                  method="post"
                  onSubmit={() => setConfirmOpen(false)}
                >
                  <input type="hidden" name="intent" value="convert-one" />
                  <input
                    type="hidden"
                    name="targetUserId"
                    value={candidate.id}
                  />
                  <Button type="submit" disabled={submitting}>
                    Convert to SSO
                  </Button>
                </fetcher.Form>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </Td>
    </Tr>
  );
}

/**
 * The "Revert to standard" button for an SSO account, with its confirmation.
 *
 * A non-owner on a domain that still uses SSO could not sign in with a
 * password after a revert, so the button is disabled with the reason shown
 * beside it. The server enforces the same rule; this only explains it up front.
 *
 * @param props.candidate - The SSO account to revert
 * @param props.domain - The searched domain, named in the disabled reason
 * @param props.isConfiguredForSSO - Whether the domain has an SSO provider
 * @param props.fetcher - The owning row's fetcher, which shows the result
 * @param props.submitting - Whether that fetcher is in flight
 * @param props.confirmOpen - Whether the confirmation dialog is open
 * @param props.setConfirmOpen - Opens or closes the confirmation dialog
 */
function RevertAction({
  candidate,
  domain,
  isConfiguredForSSO,
  fetcher,
  submitting,
  confirmOpen,
  setConfirmOpen,
}: {
  candidate: SsoConversionCandidate;
  domain: string;
  isConfiguredForSSO: boolean;
  fetcher: ReturnType<typeof useFetcher<typeof action>>;
  submitting: boolean;
  confirmOpen: boolean;
  setConfirmOpen: (open: boolean) => void;
}) {
  const blocked = isConfiguredForSSO && !candidate.ownsSsoWorkspace;
  const reasonId = `revert-reason-${candidate.id}`;

  return (
    <div className="flex flex-col items-end gap-1">
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={blocked || submitting}
            aria-describedby={blocked ? reasonId : undefined}
          >
            {submitting ? "Reverting..." : "Revert to standard"}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Revert {candidate.email} to standard login?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes the account's SSO login and signs it out of every
              session. The account has no password afterwards: the user sets one
              with Forgot password on the login page. The account keeps its data
              and user id.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button type="button" variant="secondary" disabled={submitting}>
                Cancel
              </Button>
            </AlertDialogCancel>
            <fetcher.Form method="post" onSubmit={() => setConfirmOpen(false)}>
              <input type="hidden" name="intent" value="revert" />
              <input type="hidden" name="targetUserId" value={candidate.id} />
              <Button type="submit" variant="danger" disabled={submitting}>
                Revert to standard
              </Button>
            </fetcher.Form>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {blocked ? (
        <span id={reasonId} className="max-w-xs text-xs text-gray-600">
          Only owners of the workspace that uses SSO for {domain} can be
          reverted while it uses SSO. Anyone else could not sign in with a
          password.
        </span>
      ) : null}
    </div>
  );
}
