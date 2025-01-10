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
    ? `You are receiving this email because the original person was removed from workspace ${workspaceName}.`
    : `This email was sent to ${user.email} because it is part of the Shelf workspace ${workspaceName}. 
If you think you weren't supposed to have received this email please contact the owner of the workspace.`;

  return `Asset reminder notice

Hi ${userName}, your asset reminder date has been reached. Please
perform the required action for alert.

${asset.title}
${asset.id}

Reminder - ${reminder.name}

${reminder.message}

${SERVER_URL}/assets/${asset.id}

${note}

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
