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
import { LogoForEmail } from "~/emails/logo";
import { styles } from "~/emails/styles";
import { SERVER_URL } from "~/utils/env";

type AssetAlertEmailProps = {
  user: Pick<User, "email" | "firstName" | "lastName" | "email">;
  asset: Pick<Asset, "id" | "title" | "mainImage" | "mainImageExpiration">;
  reminder: AssetReminder;
  workspaceName: string;
  isOwner?: boolean;
};

export function assetAlertEmailText({
  user,
  asset,
  reminder,
  workspaceName,
  isOwner,
}: AssetAlertEmailProps) {
  const userName = `${user.firstName?.trim()} ${user.lastName?.trim()}`;

  const note = isOwner
    ? `You're receiving this because you own workspace ${workspaceName}.`
    : `This reminder was set in workspace ${workspaceName}.`;
  const followUp = isOwner
    ? ""
    : "If this looks wrong, contact your workspace admin.";

  return `Hi ${userName},

Your asset reminder is due today.

**${asset.title}**
ID: ${asset.id}

**Reminder:** ${reminder.name}
**Action needed:** ${reminder.message}

→ View asset: ${SERVER_URL}/assets/${asset.id}

${note}
${followUp ? `\n${followUp}` : ""}

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
}: AssetAlertEmailProps) {
  const userName = `${user.firstName?.trim()} ${user.lastName?.trim()}`;

  const isEmailExpired = isAssetImageExpired(asset.mainImageExpiration);

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
            Hi {userName}, your asset reminder is due today.
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
            Reminder: {reminder.name}
          </Text>
          <Text
            style={{ ...styles.p, marginBottom: "12px", textAlign: "left" }}
          >
            Action needed: {reminder.message}
          </Text>

          <Button
            href={`${SERVER_URL}/assets/${asset.id}`}
            style={{
              ...styles.button,
              textAlign: "center",
              marginBottom: "30px",
            }}
          >
            View asset
          </Button>

          {isOwner ? (
            <Text style={{ ...styles.p, marginBottom: "48px" }}>
              You're receiving this because you own workspace{" "}
              <span style={{ fontWeight: "bold" }}>{workspaceName}</span>.
            </Text>
          ) : (
            <>
              <Text style={{ ...styles.p, marginBottom: "10px" }}>
                This reminder was set in workspace{" "}
                <span style={{ fontWeight: "bold" }}>{workspaceName}</span>.
              </Text>
              <Text style={{ ...styles.p, marginBottom: "48px" }}>
                If this looks wrong, contact your workspace admin.
              </Text>
            </>
          )}

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
