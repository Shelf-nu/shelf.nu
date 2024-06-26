import * as Sentry from "@sentry/remix";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    // Performance Monitoring
    tracesSampleRate: 0.1,
    beforeBreadcrumb(breadcrumb) {
      // Remove some noisy breadcrumbs
      if (
        breadcrumb.message?.startsWith("🚀") ||
        breadcrumb.message?.startsWith("🌍")
      ) {
        return null;
      }

      if (breadcrumb.message) {
        // Remove chalk colors that pollute the logs
        breadcrumb.message = breadcrumb.message.replace(
          // eslint-disable-next-line no-control-regex -- let me do my thing
          /(\x1B\[32m|\x1B\[0m)/gm,
          ""
        );
      }

      return breadcrumb;
    },
  });
}
