/**
 * Multipart POST for file uploads.
 *
 * Files are sent as React Native file parts (`{ uri, type, name }` appended to
 * a `FormData`). Only React Native's own networking can send those: it reads
 * the file from disk natively, so the photo never passes through JS memory.
 * The global `fetch` is Expo's implementation, which rejects `uri` parts
 * ("Unsupported FormDataPart implementation"), so uploads go through
 * `XMLHttpRequest` instead. Keep it that way for any body carrying a file.
 *
 * @see ./client.ts `apiUpload`, the only caller
 */

/** The parts of an HTTP response `apiUpload` reads. */
export type MultipartResponse = {
  status: number;
  ok: boolean;
  text: string;
};

type MultipartRequest = {
  headers: Record<string, string>;
  body: FormData;
  timeoutMs: number;
};

/**
 * POSTs a `FormData` body and resolves with the response once it is complete.
 *
 * Content-Type is left to the platform, which adds the multipart boundary.
 *
 * @param url - Absolute URL to POST to
 * @param request - Headers, the form body, and the time allowed for the
 *   whole request
 * @param Xhr - The XMLHttpRequest class to use; tests pass a fake
 * @returns The status and raw body text, for any HTTP status
 * @throws {Error} Named `AbortError` when the request exceeds `timeoutMs`
 * @throws {TypeError} When the request fails without an HTTP response
 */
export function postMultipart(
  url: string,
  { headers, body, timeoutMs }: MultipartRequest,
  Xhr: typeof XMLHttpRequest = XMLHttpRequest
): Promise<MultipartResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new Xhr();
    xhr.open("POST", url);
    for (const [name, value] of Object.entries(headers)) {
      xhr.setRequestHeader(name, value);
    }
    // The time limit is a JS timer rather than `xhr.timeout`: the native
    // timeout counts idle time only on iOS, and on Android it surfaces as a
    // plain network error, so neither bounds the whole upload reliably.
    const timer = setTimeout(() => {
      xhr.abort();
      reject(
        Object.assign(new Error("The upload timed out."), {
          name: "AbortError",
        })
      );
    }, timeoutMs);

    xhr.onload = () => {
      clearTimeout(timer);
      resolve({
        status: xhr.status,
        ok: xhr.status >= 200 && xhr.status < 300,
        text: xhr.responseText ?? "",
      });
    };
    xhr.onerror = () => {
      clearTimeout(timer);
      reject(new TypeError("Network request failed"));
    };

    xhr.send(body);
  });
}
