# Color System & Dark Mode Guide

Shelf.nu uses a comprehensive semantic color system that automatically adapts between light and dark modes. This guide explains how to use and extend the color system.

## Overview

The color system is inspired by **VitePress** and uses semantic tokens instead of hardcoded colors. This approach ensures:

- **Automatic dark mode support** - Colors adapt without manual dark mode variants
- **Consistent theming** - All colors work together harmoniously
- **Better maintainability** - Change colors in one place
- **Perfect layering** - Opacity-based colors that blend naturally

## Architecture

### 1. Semantic Color Tokens

Instead of using hardcoded Tailwind classes like `bg-gray-100`, we use semantic tokens:

```tsx
// ❌ Hardcoded - requires manual dark mode handling
<div className="bg-gray-100 dark:bg-gray-800">

// ✅ Semantic - automatically adapts
<div className="bg-color-100">

// ✅ Adaptive - works on any background
<div className="bg-muted">
```

### 2. System Components

**CSS Variables** (`app/styles/global.css`):

- Define color values for light and dark modes
- Automatically switch via `.dark` class

**Tailwind Configuration** (`tailwind.config.ts`):

- Maps semantic tokens to CSS variables
- Ensures classes are generated correctly

**Client Hints** (`app/utils/client-hints.tsx`):

- Detects system preference and user overrides
- Stores theme preference in localStorage

## Color Categories

### Text Colors

| Class            | Usage          | Light Mode | Dark Mode |
| ---------------- | -------------- | ---------- | --------- |
| `text-color-900` | Primary text   | `#101828`  | `#dfdfd6` |
| `text-color-700` | Secondary text | `#344054`  | `#c7c7c0` |
| `text-color-600` | Body text      | `#475467`  | `#98989f` |
| `text-color-500` | Muted text     | `#667085`  | `#8c8c93` |
| `text-color-400` | Subtle text    | `#98a2b3`  | `#6a6a71` |
| `text-color-300` | Disabled text  | `#d0d5dd`  | `#52525b` |

### Background Colors

| Class          | Usage                | Light Mode | Dark Mode |
| -------------- | -------------------- | ---------- | --------- |
| `bg-surface`   | Main background      | `#ffffff`  | `#1b1b1f` |
| `bg-color-50`  | Secondary background | `#f9fafb`  | `#27272a` |
| `bg-color-100` | Card background      | `#f2f4f7`  | `#18181b` |
| `bg-color-200` | Elevated background  | `#eaecf0`  | `#18181b` |

### Adaptive Colors (Recommended)

These use opacity to blend with any background:

| Class        | Usage               | Opacity | Example Use   |
| ------------ | ------------------- | ------- | ------------- |
| `bg-soft`    | Very subtle overlay | 4%      | Hover states  |
| `bg-muted`   | Subtle background   | 8%      | Badges, pills |
| `bg-subtle`  | Visible sections    | 12%     | Cards, panels |
| `bg-overlay` | Modal backdrops     | 50%     | Overlays      |

### Border Colors

| Class              | Usage           | Light Mode | Dark Mode |
| ------------------ | --------------- | ---------- | --------- |
| `border-color-200` | Primary borders | `#eaecf0`  | `#2e2e32` |
| `border-color-300` | Subtle borders  | `#d0d5dd`  | `#3c3f44` |
| `border-color-400` | Medium borders  | `#98a2b3`  | `#6a6a71` |
| `border-color-600` | Strong borders  | `#475467`  | `#98989f` |

### Primary Colors

| Class              | Usage               | Light Mode | Dark Mode |
| ------------------ | ------------------- | ---------- | --------- |
| `bg-primary`       | Primary buttons     | `#ef6820`  | `#ff8a50` |
| `bg-primary-50`    | Primary backgrounds | `#fef6ee`  | `#2a1f1a` |
| `bg-primary-100`   | Primary highlights  | `#fdead7`  | `#3a2b22` |
| `text-primary`     | Primary text        | `#ef6820`  | `#ff8a50` |
| `text-primary-700` | Primary accent      | `#ef6820`  | `#ff8a50` |

## Theme Management

### System Detection

The app automatically detects the user's system preference:

```tsx
// Client hints check system preference
theme: {
  cookieName: "CH-theme",
  getValueCode: `localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')`,
  fallback: "light",
}
```

### Manual Theme Toggle

For development, use the `ThemeToggle` component:

```tsx
import { ThemeToggle } from "~/components/dev/theme-toggle";

// Only shows in development
<ThemeToggle />;
```

The toggle:

- Stores preference in `localStorage`
- Updates client hint cookie
- Applies theme class immediately

### Theme Persistence

Theme preference is stored in:

1. **localStorage** - `theme` key (`"light"` or `"dark"`)
2. **Cookie** - `CH-theme` for server-side rendering
3. **HTML class** - `.dark` class on `<html>` element

## Best Practices

### 1. Use Semantic Tokens

```tsx
// ✅ Good - automatic dark mode
<div className="bg-color-100 text-color-700 border-color-200">

// ❌ Avoid - requires manual dark mode
<div className="bg-gray-100 text-gray-700 border-gray-200">
```

### 2. Prefer Adaptive Colors

```tsx
// ✅ Best - works on any background
<div className="bg-muted">

// ✅ Good - semantic but needs more management
<div className="bg-color-100">

// ❌ Bad - hardcoded
<div className="bg-gray-100">
```

### 3. Test Both Modes

Always test components in both light and dark modes:

- Use the development theme toggle
- Check hover states and interactions
- Verify text contrast and readability

### 4. Layer Colors Properly

```tsx
// ✅ Good layering
<div className="bg-surface">
  <div className="bg-muted">
    <div className="bg-subtle">Content</div>
  </div>
</div>
```

## Common Patterns

### Badges and Pills

```tsx
// Gray badge with adaptive background
<span className="bg-muted text-color-700 px-2 py-1 rounded">Badge</span>
```

### Cards and Panels

```tsx
// Card with proper layering
<div className="bg-surface border border-color-200 rounded-lg">
  <div className="bg-soft p-4">Card content</div>
</div>
```

### Buttons

```tsx
// Primary button
<button className="bg-primary text-white hover:bg-primary-hover">

// Secondary button
<button className="bg-surface border border-color-300 text-color-700 hover:bg-color-50">
```

## Extending the System

### Adding New Colors

1. **Add CSS variables** to `app/styles/global.css`:

```css
:root {
  --new-color-token: #lightvalue;
}
.dark {
  --new-color-token: #darkvalue;
}
```

2. **Add to Tailwind config** in `tailwind.config.ts`:

```ts
backgroundColor: {
  "new-token": "var(--new-color-token)",
}
```

3. **Add to safelist** for dynamic classes:

```ts
{
  pattern: /^(bg-new-token)$/,
  variants: ["hover", "focus", "active"],
}
```

### Creating Adaptive Colors

Use `color-mix()` for opacity-based colors:

```css
--adaptive-color: color-mix(in srgb, var(--text-color-900) 10%, transparent);
```

## Migration Guide

### From Hardcoded to Semantic

When updating existing components:

1. **Identify hardcoded classes**: `bg-gray-100`, `text-gray-700`, etc.
2. **Replace with semantic tokens**: `bg-color-100`, `text-color-700`
3. **Consider adaptive alternatives**: `bg-muted` instead of `bg-color-100`
4. **Test both modes**: Verify the component works in light and dark

### Common Replacements

| Old Class         | New Class          | Better Alternative |
| ----------------- | ------------------ | ------------------ |
| `bg-gray-100`     | `bg-color-100`     | `bg-muted`         |
| `bg-gray-50`      | `bg-color-50`      | `bg-soft`          |
| `text-gray-700`   | `text-color-700`   | -                  |
| `border-gray-200` | `border-color-200` | -                  |
| `bg-gray-700/50`  | `bg-overlay`       | -                  |

## Implementation Status

- ✅ System preference detection
- ✅ Semantic color token system
- ✅ VitePress-inspired dark mode colors
- ✅ Development theme toggle
- ✅ Adaptive opacity-based colors
- ✅ CSS variables and Tailwind integration
- ✅ Client hints and localStorage persistence

## Notes

- Light mode preserves the existing visual design
- Dark mode uses VitePress color scheme for consistency
- All color changes are backward compatible
- Remove `ThemeToggle` component before production deployment
- System automatically handles server-side rendering
