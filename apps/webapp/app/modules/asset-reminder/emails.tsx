import type { Asset, AssetReminder, User } from "@prisma/client";
import {
  Button,
  Column,
  Container,
  Head,
  Html,
  render,
  Row,
  Text,
} from "@react-email/components";
import colors from "tailwindcss/colors";
import { CustomEmailFooter } from "~/emails/components/custom-footer";
import { LogoForEmail } from "~/emails/logo";
import { styles } from "~/emails/styles";
import { formatDate, type ResolvedFormatPrefs } from "~/utils/date-format";
import { SERVER_URL } from "~/utils/env";
import { resolveUserDisplayName } from "~/utils/user";
import { describeRecurrence, formatOccurrenceInZone } from "./recurrence";

type AssetAlertEmailProps = {
  user: Pick<User, "email" | "firstName" | "lastName" | "displayName">;
  asset: Pick<Asset, "id" | "title" | "mainImage" | "mainImageExpiration">;
  reminder: AssetReminder;
  workspaceName: string;
  isOwner?: boolean;
  customEmailFooter?: string | null;
  /** Next occurrence of a recurring series, when one was scheduled. */
  nextOccurrence?: Date | null;
  /** The recipient's date format and timezone, when they could be resolved. */
  prefs?: ResolvedFormatPrefs;
  /** Set when this occurrence ends the series or is the last one sent. */
  seriesStatus?: SeriesStopReason;
};

/** Why a recurring series sends nothing after this occurrence. */
export type SeriesStopReason = "ended" | "paused";

/**
 * What the email and the asset note say when a series stops after this
 * occurrence. Shared so both always tell the same story.
 */
export const SERIES_STOP_MESSAGES: Record<SeriesStopReason, string> = {
  ended:
    "This was the last occurrence of this recurring reminder (end date reached).",
  paused:
    "Later occurrences of this recurring reminder will not be sent until the workspace plan includes recurring reminders again.",
};

/**
 * "Repeats every 3 months. Next reminder: Oct 15, 2026, 09:00 (Europe/Berlin)."
 * The date follows the recipient's own date format and timezone; without
 * resolved prefs it falls back to the series' timezone. The zone label keeps
 * the time unambiguous either way.
 *
 * @param reminder - The reminder, for its cadence and series timezone.
 * @param nextOccurrence - The next scheduled occurrence, if any.
 * @param prefs - The recipient's resolved date format and timezone.
 * @param seriesStatus - Set when the series sends nothing after this one.
 * @returns The line, or null for a one-time reminder.
 */
export function recurrenceLine(
  reminder: Pick<
    AssetReminder,
    "recurrenceUnit" | "recurrenceInterval" | "recurrenceTimezone"
  >,
  nextOccurrence?: Date | null,
  prefs?: ResolvedFormatPrefs,
  seriesStatus?: SeriesStopReason
): string | null {
  if (seriesStatus) return SERIES_STOP_MESSAGES[seriesStatus];

  const cadence = describeRecurrence(reminder);
  if (!cadence || !nextOccurrence) return null;

  // Preset labels mix adjectives ("Monthly") and phrases ("Every 3 months");
  // lowercasing the first letter makes both read after "Repeats".
  const repeats = cadence.charAt(0).toLowerCase() + cadence.slice(1);
  const when = prefs
    ? `${formatDate(nextOccurrence, prefs, { includeTime: true })} (${
        prefs.timeZone
      })`
    : formatOccurrenceInZone(nextOccurrence, reminder.recurrenceTimezone);

  return `Repeats ${repeats}. Next reminder: ${when}.`;
}

export function assetAlertEmailText({
  user,
  asset,
  reminder,
  workspaceName,
  isOwner,
  customEmailFooter,
  nextOccurrence,
  prefs,
  seriesStatus,
}: AssetAlertEmailProps) {
  const userName = resolveUserDisplayName(user);

  const note = isOwner
    ? `You are receiving this email because the original person was removed from workspace ${workspaceName}.`
    : `This email was sent to ${user.email} because it is part of the Shelf workspace ${workspaceName}.
If you think you weren't supposed to have received this email please contact the owner of the workspace.`;

  const recurrence = recurrenceLine(
    reminder,
    nextOccurrence,
    prefs,
    seriesStatus
  );

  return `Asset reminder notice

Hi ${userName}, your asset reminder date has been reached. Please
perform the required action for alert.

${asset.title}
${asset.id}

Reminder - ${reminder.name}

${reminder.message}
${recurrence ? `\n${recurrence}\n` : ""}
${SERVER_URL}/assets/${asset.id}

${note}
${customEmailFooter ? `\n---\n${customEmailFooter}` : ""}
Thanks,
The Shelf Team
`;
}

function isAssetImageExpired(expiry: Asset["mainImageExpiration"]) {
  if (!expiry) {
    return false;
  }

  const now = new Date();
  const expiration = new Date(expiry);

  return now > expiration;
}

function AssetAlertEmailTemplate({
  asset,
  reminder,
  user,
  workspaceName,
  isOwner,
  customEmailFooter,
  nextOccurrence,
  prefs,
  seriesStatus,
}: AssetAlertEmailProps) {
  const userName = resolveUserDisplayName(user);

  const isEmailExpired = isAssetImageExpired(asset.mainImageExpiration);

  const recurrence = recurrenceLine(
    reminder,
    nextOccurrence,
    prefs,
    seriesStatus
  );

  return (
    <Html>
      <Head>
        <title>Asset Reminder Notice</title>
      </Head>

      <Container
        style={{
          padding: "32px 16px",
          maxWidth: "600px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <LogoForEmail />
        </div>

        <div style={{ paddingTop: "8px" }}>
          <Text style={styles.h1}>Asset Reminder Notice</Text>

          <Text style={{ marginBottom: "20px", ...styles.p }}>
            Hi {userName}, your asset reminder date has been reached. Please
            perform the required actions for this alert.
          </Text>

          <Row
            style={{
              marginBottom: "32px",
              padding: "12px",
              border: `1px solid ${colors.gray["300"]}`,
              borderRadius: "4px",
            }}
          >
            {asset?.mainImage && !isEmailExpired ? (
              <Column>
                <img
                  src={asset.mainImage}
                  alt="asset"
                  style={{
                    width: "50px",
                    height: "50px",
                    borderRadius: "4px",
                    objectFit: "cover",
                    marginRight: "12px",
                  }}
                />
              </Column>
            ) : null}

            <Column>
              <Text
                style={{
                  ...styles.h2,
                  textAlign: "left",
                  margin: "0px !important",
                }}
              >
                {asset.title}
              </Text>
              <Text style={{ ...styles.p, textAlign: "left", margin: 0 }}>
                {asset.id}
              </Text>
            </Column>
          </Row>

          <Text
            style={{ ...styles.h2, marginBottom: "4px", textAlign: "left" }}
          >
            {reminder.name}
          </Text>
          <Text
            style={{ ...styles.p, marginBottom: "32px", textAlign: "left" }}
          >
            {reminder.message}
          </Text>

          {recurrence ? (
            <Text
              style={{ ...styles.p, marginBottom: "32px", textAlign: "left" }}
            >
              {recurrence}
            </Text>
          ) : null}

          <Button
            href={`${SERVER_URL}/assets/${asset.id}`}
            style={{
              ...styles.button,
              textAlign: "center",
              marginBottom: "30px",
            }}
          >
            Open asset page
          </Button>

          {isOwner ? (
            <Text style={{ ...styles.p, marginBottom: "48px" }}>
              You are receiving this email because the original person was
              removed from workspace{" "}
              <span style={{ fontWeight: "bold" }}>{workspaceName}</span>.
            </Text>
          ) : (
            <>
              <Text style={{ ...styles.p, marginBottom: "10px" }}>
                This email was sent to{" "}
                <span style={{ fontWeight: "bold" }}>{user.email}</span> because
                it is part of the Shelf workspace{" "}
                <span style={{ fontWeight: "bold" }}>{workspaceName}</span>.
              </Text>
              <Text style={{ ...styles.p, marginBottom: "48px" }}>
                If you think you weren't supposed to have received this email
                please contact the owner of the workspace.
              </Text>
            </>
          )}

          <CustomEmailFooter footerText={customEmailFooter} />

          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <LogoForEmail />
          </div>
        </div>
      </Container>
    </Html>
  );
}

export function assetAlertEmailHtmlString(props: AssetAlertEmailProps) {
  return render(<AssetAlertEmailTemplate {...props} />);
}
