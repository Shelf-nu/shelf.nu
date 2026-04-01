/**
 * Cloudflare Web Analytics
 *
 * Conditionally loads the Cloudflare Web Analytics beacon script
 * when the `CLOUDFLARE_WEB_ANALYTICS_TOKEN` environment variable is set.
 * This allows the open-source codebase to remain token-free while
 * enabling analytics on deployed instances.
 *
 * @see https://developers.cloudflare.com/analytics/web-analytics/
 */
export function CloudflareWebAnalytics() {
  if (
    typeof window === "undefined" ||
    !window.env.CLOUDFLARE_WEB_ANALYTICS_TOKEN
  ) {
    return null;
  }

  return (
    <script
      defer
      src="https://static.cloudflareinsights.com/beacon.min.js"
      data-cf-beacon={JSON.stringify({
        token: window.env.CLOUDFLARE_WEB_ANALYTICS_TOKEN,
      })}
    />
  );
}
