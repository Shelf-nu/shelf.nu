import { config } from "~/config/shelf.config";

export const styles = {
  button: {
    marginBottom: "6px",
    display: "inline-flex",
    maxWidth: "170px",
    alignItems: "center",
    justifyContent: "center",
    gap: "2",
    border: `1px solid ${config.emailPrimaryColor}`,
    backgroundColor: config.emailPrimaryColor,
    textAlign: "center",
    fontSize: "14px",
    fontWeight: "700",
    color: "white",
    padding: "10px 18px",
    borderRadius: "4px",
  },
  h1: {
    fontSize: "20px",
    color: "#101828",
    fontWeight: "600",
    marginBottom: "16px",
  },
  h2: {
    fontSize: "16px",
    color: "#101828",
    fontWeight: "600",
    marginBottom: "16px",
  },
  p: { fontSize: "16px", color: "#344054" },
  li: { fontSize: "16px", color: "#344054" },
};
