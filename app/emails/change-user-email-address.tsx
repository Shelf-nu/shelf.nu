import { Container, Head, Html, render, Text } from "@react-email/components";
import { SUPPORT_EMAIL } from "~/utils/env";
import { styles } from "./styles";

/**
 * THis is the text version of the change email address email
 */
export const changeEmailAddressTextEmail = ({
  otp,
  user,
}: {
  otp: string;
  user: { firstName?: string | null; lastName?: string | null; email: string };
}) => `Howdy ${user.firstName ? user.firstName : ""} ${
  user.lastName ? user.lastName : ""
},

Your email change verification code: **${otp}**

Don't share this with anyone. This code expires in 1 hour.

If you didn't request this, ignore this email and contact ${SUPPORT_EMAIL}.

Thanks,
The Shelf Team`;

function ChangeEmailAddressHtmlEmailTemplate({
  otp,
  user,
}: {
  otp: string;
  user: { firstName?: string | null; lastName?: string | null; email: string };
}) {
  return (
    <Html>
      <Head>
        <title>🔐 Verification code: {otp}</title>
      </Head>

      <Container style={{ maxWidth: "100%" }}>
        <div style={{ paddingTop: "8px" }}>
          <Text style={{ ...styles.p }}>
            Howdy{" "}
            {`${user.firstName ? user.firstName : ""} ${
              user.lastName ? user.lastName : ""
            }`}
          </Text>
          <Text style={{ ...styles.p }}>
            Your email change verification code:
          </Text>
          <h2>
            <b>{otp}</b>
          </h2>
          <Text style={{ ...styles.p }}>
            Don't share this with anyone. This code expires in 1 hour.
          </Text>
          <Text style={{ ...styles.p }}>
            If you didn't request this, ignore this email and contact{" "}
            {SUPPORT_EMAIL}.
            <br />
            <br />
            Thanks,
            <br />
            The Shelf Team
          </Text>
        </div>
      </Container>
    </Html>
  );
}

/*
 *The HTML content of an email will be accessed by a server file to send email,
  we cannot import a TSX component in a server file so we are exporting TSX converted to HTML string using render function by react-email.
 */
export const changeEmailAddressHtmlEmail = (
  otp: string,
  user: { firstName?: string | null; lastName?: string | null; email: string }
) => render(<ChangeEmailAddressHtmlEmailTemplate otp={otp} user={user} />);
