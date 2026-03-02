import { Text } from "@react-email/components";

/**
 * Renders a custom footer message in HTML emails.
 * The footerText is rendered as a React text child, which automatically
 * escapes HTML entities for defense-in-depth against injection.
 */
export function CustomEmailFooter({
  footerText,
}: {
  footerText?: string | null;
}) {
  if (!footerText) return null;

  return (
    <Text
      style={{
        fontSize: "13px",
        color: "#667085",
        borderTop: "1px solid #EAECF0",
        paddingTop: "16px",
        marginTop: "16px",
        whiteSpace: "pre-wrap",
      }}
    >
      {footerText}
    </Text>
  );
}
