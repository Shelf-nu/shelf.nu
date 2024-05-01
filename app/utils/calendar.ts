export function getStatusClass(status: any) {
  switch (status) {
    case "CONFIRMED":
      return "ongoing";
    case "COMPLETED":
      return "completed";
    case "RESERVED":
      return "reserved";
    case "DRAFT":
      return "draft";
    default:
      return "";
  }
}
