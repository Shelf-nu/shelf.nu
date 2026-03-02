# Feedback Modal Implementation Plan

## Summary

Replace the sidebar "Questions/Feedback" button (currently opens Crisp chat) with a
structured feedback modal inspired by Supabase. The modal captures categorized feedback
(Issue/Idea) with optional screenshot, sends it via email to the support team, and
includes a "Chat with us" link to Crisp for live support.

## Design Decisions

- **Email only** - No database model/migration. Uses existing email infrastructure.
- **Supabase storage** - Screenshots uploaded to existing public bucket, URL included
  in email.
- **Custom Dialog** - Uses the existing `Dialog` component from
  `app/components/layout/dialog.tsx` (focus management, ESC, backdrop click).
- **useFetcher** - Submits to API route without navigation, so the modal stays open
  for success/error feedback.
- **Follows "Updates" pattern** - The sidebar already special-cases the "Updates"
  button with its own component. We do the same for "Questions/Feedback" with a
  `FeedbackNavItem` component.

## Files to Create

### 1. `app/components/feedback/feedback-modal.tsx`

The main feedback modal component.

**UI Layout:**

- Dialog title: "Share feedback"
- Subtitle: "What would you like to share?"
- **Category toggle**: Two buttons — "Issue" and "Idea" (styled as a segmented
  control, with the active one visually selected)
- **Textarea**: Message input (required, max 5000 chars)
- **Screenshot upload**: Simple file input (drag-drop optional) for PNG/JPG/WebP,
  max 4MB. Shows thumbnail preview when a file is selected.
- **Footer**: "Chat with us" link (opens Crisp) on the left,
  "Send feedback" button on the right
- **Success state**: Brief "Thank you" message after successful submission, auto-closes
  after 2s

**Technical details:**

- Uses `useFetcher` to POST to `/api/feedback`
- Uses `useZorm` + Zod schema for client-side validation
- Displays server-side validation errors as fallback (per CLAUDE.md requirements)
- `useDisabled(fetcher)` for button disabled state
- `encType="multipart/form-data"` for file upload support
- Resets form + closes modal on success

### 2. `app/components/feedback/feedback-nav-item.tsx`

Sidebar nav item wrapper that manages feedback modal open/close state.

- Renders the `SidebarMenuItem` + `SidebarMenuButton` (same as current button)
- Contains `useState` for `isOpen`
- Renders `FeedbackModal` via `DialogPortal`
- Follows the same pattern as `UpdatesNavItem`

### 3. `app/routes/api+/feedback.ts`

API endpoint for feedback submission.

**Action handler:**

- Authenticates user via `context.getSession()`
- Uses `parseFileFormData` to handle multipart form data (uploads screenshot to
  Supabase `files` bucket under `feedback/` prefix)
- Validates type ("issue" | "idea") and message with Zod
- Calls `sendFeedbackEmail()` with user info, category, message, and optional
  screenshot URL
- Returns success or error response

### 4. `app/emails/feedback/feedback-email.tsx`

Email template for feedback notifications.

**Follows established email pattern (audit-trial-welcome.tsx):**

- React Email components (`Html`, `Head`, `Container`, `Text`, `Button`, `Link`)
- `LogoForEmail` at top
- Shared styles from `styles.ts`
- Subject: "New feedback [Issue/Idea]: First 50 chars of message..."
- Body includes: user name, email, organization, category, full message,
  screenshot link (if any)
- Both HTML and plain text exports
- `sendFeedbackEmail()` wrapper with try/catch + Logger.error + ShelfError
- Sent to `SUPPORT_EMAIL`, with `replyTo` set to the user's email

## Files to Modify

### 5. `app/components/layout/sidebar/sidebar-nav.tsx`

Add special case for feedback button (like the existing Updates pattern):

```tsx
case "button": {
  if (navItem.title === "Updates") {
    return <UpdatesNavItem />;
  }
  if (navItem.title === "Questions/Feedback") {
    return <FeedbackNavItem />;
  }
  // ... existing generic button code
}
```

### 6. `app/hooks/use-sidebar-nav-items.tsx`

Remove the Crisp import and the `onClick: () => Crisp.chat.open()` from the
"Questions/Feedback" button. The onClick is now handled inside `FeedbackNavItem`.
Keep `MessageCircleIcon` and the button type.

## Validation Schema

```typescript
const feedbackSchema = z.object({
  type: z.enum(["issue", "idea"]),
  message: z
    .string()
    .min(10, "Please provide at least 10 characters")
    .max(5000, "Message is too long"),
});
```

## Implementation Order

1. Create the Zod schema (shared between client and server)
2. Create the email template (`feedback-email.tsx`)
3. Create the API route (`api+/feedback.ts`)
4. Create the feedback modal component (`feedback-modal.tsx`)
5. Create the feedback nav item (`feedback-nav-item.tsx`)
6. Modify sidebar-nav.tsx to use `FeedbackNavItem`
7. Clean up `use-sidebar-nav-items.tsx` (remove Crisp onClick)
8. Test with `npm run typecheck` and `npm run lint`

## Accessibility

- Dialog handles focus trap, ESC key, backdrop click via existing Dialog component
- All inputs have proper labels
- Category buttons use `aria-pressed` for toggle state
- File input has descriptive label
- Submit button shows loading state
- Color contrast meets WCAG 2.1 AA
