# Product Requirements Document: Workspace Invitation Messages

## Overview

Enable workspace administrators to include an optional personalized message when inviting users to join their workspace. This message will be displayed in the invitation email to provide context and warmth to the invitation.

## Problem Statement

Currently, workspace invitations are generic and lack personalization. Users receiving invitations may not understand the context of why they're being invited or who specifically is inviting them, leading to:

- Lower acceptance rates
- Confusion about the invitation source
- Lack of context for the workspace purpose

## Goals

- **Primary**: Allow workspace admins to add optional personalized messages to invitations
- **Secondary**: Improve invitation acceptance rates through better context
- **Secondary**: Maintain security and prevent abuse (phishing, spam, XSS attacks)

## Non-Goals

- Rich text formatting (keep it plain text only)
- Message templates or suggestions
- Message history or analytics
- Reply functionality

## User Stories

1. **As a workspace admin**, I want to add a personal note to my invitation so recipients understand why they're being invited
2. **As an invitee**, I want to see a message from the inviter so I can decide whether to accept the invitation
3. **As a security-conscious admin**, I want to ensure invitation messages cannot be used for phishing or exploits

## Requirements

### Functional Requirements

#### FR1: Message Input

- Provide an optional text field for invitation messages
- Field should be clearly labeled as "Personal Message (Optional)"
- Character limit: 1000 characters
- Display character counter
- Support line breaks for readability

#### FR2: Message Storage

- Store message in database with the invitation record
- Message should be nullable (optional field)
- Preserve message for audit trail

#### FR3: Message Display

- Include message in invitation email template
- Display message in a visually distinct section
- Handle cases where no message is provided (don't show empty section)

#### FR4: Message Validation

- Maximum length: 1000 characters
- Cannot be only whitespace
- Must pass sanitization checks

### Security Requirements

#### SR1: XSS Prevention

- Sanitize all HTML entities in message text
- Strip any HTML tags or script content
- Escape special characters before email rendering

#### SR2: Phishing Prevention

- Prohibit URL-like patterns that could be misleading
- Block messages containing common phishing keywords
- Rate limit invitation sending per user/organization

#### SR3: Spam Prevention

- Limit number of invitations per day per organization
- Flag suspiciously repetitive messages
- Log all invitation messages for abuse monitoring

#### SR4: Content Security

- No executable content (JavaScript, HTML, etc.)
- Plain text only
- Validate UTF-8 encoding

### Non-Functional Requirements

#### NFR1: Performance

- Message validation should add <50ms to invitation processing
- Database queries should remain performant with message field

#### NFR2: Accessibility

- Message field should be keyboard accessible
- Screen reader compatible labels
- Clear error messaging

#### NFR3: Internationalization

- Support UTF-8 characters (international languages)
- UI labels should be translatable

## Technical Design

### Database Schema

```prisma
model TeamMemberInvite {
  // ... existing fields ...
  inviteMessage  String?  @db.VarChar(1000)  // New field
}
```

### Validation Rules

```typescript
const MESSAGE_MAX_LENGTH = 1000;
const PHISHING_PATTERNS = [
  /verify.*account/i,
  /update.*payment/i,
  /suspended.*account/i,
  /urgent.*action/i,
];

function validateInvitationMessage(message: string): boolean {
  // Length check
  if (message.length > MESSAGE_MAX_LENGTH) return false;

  // Whitespace-only check
  if (message.trim().length === 0) return false;

  // Phishing pattern check
  for (const pattern of PHISHING_PATTERNS) {
    if (pattern.test(message)) return false;
  }

  return true;
}
```

### Sanitization

```typescript
function sanitizeInvitationMessage(message: string): string {
  // Remove HTML tags
  let sanitized = message.replace(/<[^>]*>/g, "");

  // Escape HTML entities
  sanitized = sanitized
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");

  // Normalize whitespace
  sanitized = sanitized.trim();

  return sanitized;
}
```

### Email Template Update

```html
<!-- Invitation email -->
<p>Hi there,</p>

<p>You've been invited to join [Workspace Name] on Shelf.</p>

{{#if inviteMessage}}
<div
  style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 20px 0;"
>
  <p style="margin: 0; font-style: italic; color: #333;">
    Message from [Inviter Name]:
  </p>
  <p style="margin: 8px 0 0 0; white-space: pre-wrap;">{{inviteMessage}}</p>
</div>
{{/if}}

<p>[Rest of invitation email...]</p>
```

## User Interface

### Invitation Form

```
┌─────────────────────────────────────────┐
│ Invite Team Members                      │
├─────────────────────────────────────────┤
│                                          │
│ Email address *                          │
│ ┌─────────────────────────────────────┐ │
│ │ user@example.com                    │ │
│ └─────────────────────────────────────┘ │
│                                          │
│ Role *                                   │
│ ┌─────────────────────────────────────┐ │
│ │ Member                        ▼     │ │
│ └─────────────────────────────────────┘ │
│                                          │
│ Personal Message (Optional)              │
│ ┌─────────────────────────────────────┐ │
│ │                                     │ │
│ │ Add a personal note to help them    │ │
│ │ understand why you're inviting...   │ │
│ │                                     │ │
│ └─────────────────────────────────────┘ │
│ 0 / 1000 characters                      │
│                                          │
│          [Cancel]    [Send Invite]       │
└─────────────────────────────────────────┘
```

## Success Metrics

- Percentage of invitations that include messages
- Invitation acceptance rate (with vs without messages)
- Zero security incidents related to invitation messages
- Zero user complaints about spam/phishing via invitations

## Risks & Mitigations

| Risk                  | Impact | Mitigation                                          |
| --------------------- | ------ | --------------------------------------------------- |
| Phishing via messages | High   | Strict validation, pattern detection, rate limiting |
| Spam invitations      | Medium | Rate limits, monitoring, reporting mechanism        |
| XSS attacks           | High   | HTML sanitization, plain text only                  |
| Inappropriate content | Low    | Message logging, reporting feature (future)         |
| Database bloat        | Low    | 1000 char limit, consider archiving old invitations |

## Future Enhancements

- Message templates for common scenarios
- Abuse reporting mechanism
- Admin dashboard for invitation monitoring
- Message preview before sending
- Multi-language support for UI labels

## Open Questions

1. Should we allow admins to set default messages for their organization?
2. Should we notify inviter if invitation is rejected?
3. Should we show the message in the in-app invitation list?
4. Do we need a profanity filter?

## Acceptance Criteria

- [ ] Message field appears in invitation form
- [ ] Message is optional (can be left blank)
- [ ] Character limit enforced (1000 max)
- [ ] Character counter displayed
- [ ] Message stored in database
- [ ] Message appears in invitation email when provided
- [ ] HTML/scripts are sanitized
- [ ] Phishing patterns are blocked
- [ ] All existing invitation tests pass
- [ ] New tests cover message functionality
- [ ] No XSS vulnerabilities
- [ ] Passes security review

## Timeline

- Design & PRD: 1 day
- Database migration: 1 day
- Backend implementation: 2 days
- Frontend implementation: 2 days
- Email template updates: 1 day
- Testing & security review: 2 days
- Documentation: 1 day

**Total: ~10 days**

## References

- OWASP XSS Prevention: https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
- Email Security Best Practices
- Existing workspace invitation flow
