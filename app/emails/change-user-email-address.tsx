import { Container, Head, Html, render, Text } from "@react-email/components";
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

Your verification code for email change is: ${otp}

Don't share this OTP with anyone. Our customer service team will never ask you for your password, OTP, credit card, or banking info.
This code will expire in 1 hour. If you have not requested this change, please ignore the email and contact support immediately.

Kind regards,
the Shelf team`;

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
        <title>🔐 Your verification code for email change is: {otp}</title>
      </Head>

      <Container style={{ maxWidth: "100%" }}>
        <div style={{ paddingTop: "8px" }}>
          <Text style={{ ...styles.p }}>
            Howdy{" "}
            {`${user.firstName ? user.firstName : ""} ${
              user.lastName ? user.lastName : ""
            }`}
            ,
          </Text>
          <Text style={{ ...styles.p }}>
            Your verification code for email change is:
          </Text>
          <h2>
            <b>{otp}</b>
          </h2>
          <Text style={{ ...styles.p }}>
            Don't share this OTP with anyone. Our customer service team will
            never ask you for your password, OTP, credit card, or banking info.
          </Text>
          <Text style={{ ...styles.p }}>
            This code will expire in 1 hour. If you have not requested this
            change, please ignore the email and contact support immediately.
            <br />
            <br />
            Kind regards,
            <br />
            the Shelf team
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
