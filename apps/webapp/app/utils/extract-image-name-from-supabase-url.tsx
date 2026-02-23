export const extractImageNameFromSupabaseUrl = ({
  url,
  bucketName,
}: {
  url: string;
  bucketName: string;
}) => {
  const regex = new RegExp(
    `\\/${bucketName}\\/([a-f0-9-]+)\\/([a-z0-9]+)\\/([a-z0-9\\-]+\\.[a-z]{3,4})`,
    "i"
  );
  const match = url.split("?")[0].match(regex); // split the url at '?' and take the first part
  if (match) {
    const path = `${match[1]}/${match[2]}/${match[3]}`;
    return path;
  }
};
