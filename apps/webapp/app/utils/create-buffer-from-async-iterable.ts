/** Converts data Uint8Array to file... */
export async function createFileFromAsyncIterable(
  data: AsyncIterable<Uint8Array>
) {
  // Get the file as a buffer
  const chunks = [];
  for await (const chunk of data) chunks.push(chunk);
  return Buffer.concat(chunks);
}
