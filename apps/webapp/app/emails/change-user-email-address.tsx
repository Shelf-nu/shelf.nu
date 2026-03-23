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
}) => `Bonjour ${user.firstName ? user.firstName : ""} ${
  user.lastName ? user.lastName : ""
},

Votre code de vérification pour le changement d'adresse email est : ${otp}

Ne partagez ce code OTP avec personne. Notre équipe de service client ne vous demandera jamais votre mot de passe, OTP, carte de crédit ou informations bancaires.
Ce code expirera dans 1 heure. Si vous n'avez pas demandé ce changement, veuillez ignorer cet email et contacter le support immédiatement.

Cordialement,
L'équipe Shelf`;

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
        <title>
          🔐 Votre code de vérification pour le changement d'email est : {otp}
        </title>
      </Head>

      <Container style={{ maxWidth: "100%" }}>
        <div style={{ paddingTop: "8px" }}>
          <Text style={{ ...styles.p }}>
            Bonjour{" "}
            {`${user.firstName ? user.firstName : ""} ${
              user.lastName ? user.lastName : ""
            }`}
            ,
          </Text>
          <Text style={{ ...styles.p }}>
            Votre code de vérification pour le changement d'adresse email est :
          </Text>
          <h2>
            <b>{otp}</b>
          </h2>
          <Text style={{ ...styles.p }}>
            Ne partagez ce code OTP avec personne. Notre équipe de service
            client ne vous demandera jamais votre mot de passe, OTP, carte de
            crédit ou informations bancaires.
          </Text>
          <Text style={{ ...styles.p }}>
            Ce code expirera dans 1 heure. Si vous n'avez pas demandé ce
            changement, veuillez ignorer cet email et contacter le support
            immédiatement.
            <br />
            <br />
            Cordialement,
            <br />
            L'équipe Shelf
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
