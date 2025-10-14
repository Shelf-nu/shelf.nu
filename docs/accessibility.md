# Accessibility Guidelines

Shelf.nu is committed to providing an accessible experience for all users. This guide outlines our accessibility standards and provides practical guidance for developers.

## Standards

We aim to meet **WCAG 2.1 Level AA** standards for all user-facing features.

## Key Principles

### 1. Color Contrast (WCAG 2.1 AA)

All text must meet minimum contrast ratios:

- **4.5:1** for normal text (under 18pt or 14pt bold)
- **3:1** for large text (18pt+ or 14pt+ bold)

#### Using the Badge Component

The `<Badge>` component automatically ensures WCAG AA compliance:

```tsx
import { Badge } from "~/components/shared/badge";

// Any hex color will be darkened automatically for proper contrast
<Badge color="#2E90FA">In Custody</Badge>
<Badge color="#5925DC">Checked Out</Badge>
<Badge color="#12B76A">Available</Badge>
```

**How it works:** The Badge component uses `darkenColor()` to reduce RGB values by 50%, ensuring text has sufficient contrast against the 30% opacity background.

**Test results:**

- IN_CUSTODY badge: 6.69:1 ✓ (exceeds AA, approaching AAA)
- CHECKED_OUT badge: 8.59:1 ✓ (exceeds AAA)
- AVAILABLE badge: 6.02:1 ✓ (exceeds AA, approaching AAA)

#### Color Contrast Utilities

For custom components, use the utilities in `app/utils/color-contrast.ts`:

```tsx
import {
  getContrastRatio,
  meetsWCAG_AA,
  meetsWCAG_AAA,
  getAccessibleTextColor,
  darkenColor,
} from "~/utils/color-contrast";

// Check if two colors meet WCAG AA
const isAccessible = meetsWCAG_AA("#2E90FA", "#FFFFFF"); // true

// Get contrast ratio
const ratio = getContrastRatio("#2E90FA", "#FFFFFF"); // 6.69

// Determine if text should be black or white
const textColor = getAccessibleTextColor("#2E90FA"); // "#000000"

// Darken a color for better contrast
const darkened = darkenColor("#2E90FA", 0.5); // "#174578"
```

#### Tailwind Color Guidelines

When using Tailwind utility classes:

✅ **Good combinations:**

```tsx
<div className="bg-primary-50 text-primary-800">Safe contrast</div>
<div className="bg-gray-100 text-gray-700">Safe contrast</div>
<div className="bg-success-100 text-success-800">Safe contrast</div>
```

❌ **Avoid:**

```tsx
<div className="bg-primary-50 text-primary-500">Poor contrast</div>
<div className="bg-gray-100 text-gray-400">Poor contrast</div>
```

**Rule of thumb:** For `*-50` or `*-100` backgrounds, use `*-700` or `*-800` text.

### 2. Keyboard Navigation

All interactive elements must be keyboard accessible.

#### Focus Indicators

All focusable elements should have visible focus indicators. The Button component includes `focus:ring-2` for primary and danger variants:

```tsx
// Button component automatically includes focus states
<Button variant="primary">Has focus ring</Button>
<Button variant="danger">Has focus ring</Button>
<Button variant="secondary">Has border focus</Button>
```

For custom interactive elements:

```tsx
// Add visible focus state
<button className="focus:ring-2 focus:ring-primary focus:outline-none">
  Custom Button
</button>
```

#### Tab Order

Ensure logical tab order by:

- Using semantic HTML (`<button>`, `<a>`, `<input>`)
- Avoiding `tabindex` values greater than 0
- Only using `tabindex="-1"` to programmatically remove from tab order

```tsx
// Good - semantic HTML maintains natural tab order
<button onClick={handleClick}>Click me</button>

// Avoid - non-semantic elements require extra attributes
<div onClick={handleClick} role="button" tabIndex={0}>Click me</div>
```

### 3. Modals and Dialogs

#### Escape Key Behavior

All modals and dialogs must close when the Escape key is pressed.

**Radix UI modals** (AlertDialog, Sheet) handle this automatically:

```tsx
import { AlertDialog, AlertDialogContent } from "~/components/shared/modal";

// Escape key handling is built-in
<AlertDialog open={isOpen} onOpenChange={setIsOpen}>
  <AlertDialogContent>{/* Content */}</AlertDialogContent>
</AlertDialog>;
```

**Native dialog elements** require manual handling:

```tsx
import { Dialog } from "~/components/layout/dialog";

// Dialog component includes useEffect for Escape key
<Dialog open={isOpen} onClose={handleClose} title="My Dialog">
  {/* Content */}
</Dialog>;
```

#### Focus Management

Modals should:

- ✅ Trap focus within the modal when open
- ✅ Return focus to the trigger element when closed
- ✅ Set initial focus to the first focusable element or close button

**Radix UI components handle this automatically.** For custom modals, use focus trap libraries like `react-focus-lock` or `@radix-ui/react-focus-scope`.

### 4. Screen Reader Announcements

#### Toast Notifications

The Toast component uses Radix UI Toast which provides automatic aria-live announcements:

```tsx
import { showNotificationAtom } from "~/atoms/notifications";

// Automatically announced to screen readers
showNotification({
  title: "Success",
  message: "Your changes have been saved",
  icon: { name: "success", variant: "success" },
});
```

**Implementation:** Toast uses aria-live regions built into Radix UI, plus explicit `aria-label` on the close button.

#### Dynamic Content Updates

For other dynamic content updates:

```tsx
// Polite announcement (waits for user to pause)
<div aria-live="polite" aria-atomic="true">
  {statusMessage}
</div>

// Assertive announcement (interrupts screen reader)
<div aria-live="assertive" aria-atomic="true">
  {errorMessage}
</div>
```

#### Labels and Descriptions

All interactive elements must have accessible names:

```tsx
// Buttons with text content
<Button>Submit</Button> // ✓ Text provides accessible name

// Icon-only buttons need aria-label
<Button aria-label="Close dialog">
  <XIcon />
</Button>

// Form inputs need labels
<label htmlFor="email">Email</label>
<input id="email" type="email" />

// Or use aria-label when visual label isn't appropriate
<input type="search" aria-label="Search assets" />
```

## Testing Checklist

### Automated Testing

Run color contrast tests:

```bash
npm run test app/utils/color-contrast.test.ts
```

### Manual Testing

#### Keyboard Navigation

- [ ] Tab through all interactive elements
- [ ] Verify visible focus indicators on all focusable elements
- [ ] Test Escape key closes modals and returns focus
- [ ] Test Enter/Space activates buttons and links
- [ ] Verify no keyboard traps (can tab out of all components)

#### Screen Reader Testing

**macOS (VoiceOver):**

```bash
# Start VoiceOver
Cmd+F5

# Navigate
Ctrl+Option+Arrow keys
```

**Windows (NVDA):**

- Download from [nvaccess.org](https://www.nvaccess.org)
- Navigate with arrow keys

**Test:**

- [ ] Toast notifications are announced
- [ ] Form labels and errors are announced
- [ ] Button labels are descriptive
- [ ] Dynamic content updates are announced
- [ ] Modal dialogs announce title and content

#### Color Contrast

**Browser DevTools:**

1. Inspect element
2. Check "Contrast" in Styles panel
3. Verify ratio meets 4.5:1 (or 3:1 for large text)

**Online tools:**

- [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)
- [Colorable](https://colorable.jxnblk.com/)

#### Color Blindness

Test with browser extensions:

- Chrome: [Colorblindly](https://chrome.google.com/webstore/detail/colorblindly)
- Firefox: [Colorblind](https://addons.mozilla.org/en-US/firefox/addon/colorblind/)

Verify information isn't conveyed by color alone.

## Common Patterns

### Loading States

```tsx
// Screen reader announcement for loading
<div role="status" aria-live="polite">
  {isLoading ? "Loading..." : null}
</div>
```

### Error Messages

```tsx
// Associate error with input using aria-describedby
<input
  id="email"
  aria-invalid={hasError}
  aria-describedby={hasError ? "email-error" : undefined}
/>;
{
  hasError && (
    <div id="email-error" role="alert">
      {errorMessage}
    </div>
  );
}
```

### Tooltips

```tsx
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/shared/tooltip";

// Radix UI handles accessibility
<Tooltip>
  <TooltipTrigger>
    <InfoIcon />
  </TooltipTrigger>
  <TooltipContent>
    <p>Additional information</p>
  </TooltipContent>
</Tooltip>;
```

### Disabled Buttons with Explanation

```tsx
<Button
  disabled={{
    title: "Action disabled",
    reason: "You need admin permissions to perform this action",
  }}
>
  Delete
</Button>

// Button component shows tooltip on hover
```

## Component Library

Shelf uses [Radix UI](https://www.radix-ui.com) primitives which provide:

- ✅ Built-in keyboard navigation
- ✅ ARIA attributes
- ✅ Focus management
- ✅ Screen reader support

When building new components, prefer Radix UI primitives over custom implementations.

## Resources

- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [Radix UI Accessibility](https://www.radix-ui.com/primitives/docs/overview/accessibility)
- [WebAIM Color Contrast Checker](https://webaim.org/resources/contrastchecker/)
- [a11y Project Checklist](https://www.a11yproject.com/checklist/)
- [ARIA Authoring Practices Guide](https://www.w3.org/WAI/ARIA/apg/)

## Getting Help

If you have questions about accessibility:

1. Check this guide and linked resources
2. Test with the tools mentioned above
3. Ask in the team Discord #development channel
4. Review similar patterns in the codebase

Remember: Accessibility is not a feature—it's a requirement for inclusive software.
