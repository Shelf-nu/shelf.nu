export const getFileArrayBuffer = async (data: AsyncIterable<Uint8Array>) => {
  const chunks = [];
  for await (const chunk of data) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
};
