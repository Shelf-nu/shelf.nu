import { z } from "zod";

/**
 * Max lengths for the auto-captured context fields. Shared with the client
 * (feedback-modal.tsx clamps the values before putting them in hidden
 * inputs) so an oversized URL or crash message can never fail validation
 * and silently block the submission.
 */
export const FEEDBACK_FIELD_LIMITS = {
  currentUrl: 2048,
  viewport: 100,
  traceId: 120,
  sentryEventId: 120,
  errorStatus: 10,
  errorTitle: 300,
  errorMessage: 3000,
} as const;

/**
 * Validation schema for in-app feedback submissions (issues and ideas).
 *
 * Besides the user-authored `type` + `message`, the schema accepts optional
 * context fields that the client attaches automatically (never typed by the
 * user): the page the feedback was sent from and, for reports started from an
 * error page, the error details shown on that page. All of them are plain
 * strings that only travel into the internal support email, but they get max
 * lengths so the endpoint can't be used to relay arbitrarily large payloads.
 *
 * @see {@link file://./../../routes/api+/feedback.ts}
 * @see {@link file://./../../components/feedback/feedback-modal.tsx}
 */
export const feedbackSchema = z.object({
  type: z.enum(["issue", "idea"]),
  message: z
    .string()
    .min(10, "Please provide at least 10 characters")
    .max(5000, "Message is too long"),
  /** URL of the page the user submitted the feedback from */
  currentUrl: z.string().max(FEEDBACK_FIELD_LIMITS.currentUrl).optional(),
  /** Browser viewport, e.g. "1512x824 @2x" */
  viewport: z.string().max(FEEDBACK_FIELD_LIMITS.viewport).optional(),
  /** ShelfError trace id shown on the error page the report started from */
  traceId: z.string().max(FEEDBACK_FIELD_LIMITS.traceId).optional(),
  /** Sentry event id for client-side crashes captured by the error boundary */
  sentryEventId: z.string().max(FEEDBACK_FIELD_LIMITS.sentryEventId).optional(),
  /** HTTP status of the failed response, e.g. "500" */
  errorStatus: z.string().max(FEEDBACK_FIELD_LIMITS.errorStatus).optional(),
  /** User-facing title rendered on the error page */
  errorTitle: z.string().max(FEEDBACK_FIELD_LIMITS.errorTitle).optional(),
  /** User-facing message rendered on the error page */
  errorMessage: z.string().max(FEEDBACK_FIELD_LIMITS.errorMessage).optional(),
});

/** The error-page fields of the schema, in the order they render */
export const FEEDBACK_ERROR_CONTEXT_FIELDS = [
  "traceId",
  "sentryEventId",
  "errorStatus",
  "errorTitle",
  "errorMessage",
] as const;

const feedbackErrorContextSchema = feedbackSchema.pick({
  traceId: true,
  sentryEventId: true,
  errorStatus: true,
  errorTitle: true,
  errorMessage: true,
});

/**
 * Error details attached automatically when a report is started from an
 * error page. Derived from {@link feedbackSchema} so the type can never
 * drift from the validation.
 */
export type FeedbackErrorContext = z.infer<typeof feedbackErrorContextSchema>;
