## PR #2148 Review: Activity Logging for Locations

I've thoroughly reviewed this PR and compared it against the existing notes functionality for assets and bookings. Here are my findings:

---

## 🚨 Critical Issues

### 1. **BUG: Switch Component Missing `when` Props**

**File:** `app/components/location/notes/note.tsx:25-29`

This is a **critical bug** that breaks the entire note rendering. The `Switch` component requires `when` props to conditionally render children, but the location notes don't provide them:

```tsx
// ❌ BROKEN - Current implementation
<Switch>
  <Comment note={note} canDelete={canDelete} />
  <Update note={note} />
</Switch>

// ✅ CORRECT - How asset/booking notes do it (app/components/assets/notes/note.tsx:30-37)
<Switch>
  <Comment when={note.type === "COMMENT"} note={note} actionsDropdown={actionsDropdown} />
  <Update when={note.type === "UPDATE"} note={note} />
</Switch>
```

**Result**: All notes render as `UPDATE` style (since it's the last child and becomes the default fallback), meaning COMMENT notes will never show author info or delete actions.

---

### 2. **Not Using Shared `Note` Component**

The PR creates a duplicate `LocationNoteItem` component (`app/components/location/notes/note.tsx`) instead of reusing the **existing shared** `Note` component from `app/components/assets/notes/note.tsx`.

**Booking notes already reuse this component** - see `app/components/booking/notes/index.tsx:2-3`:

```tsx
import type { NoteWithUser } from "~/components/assets/notes/note";
import { Note } from "~/components/assets/notes/note";
```

Location notes should follow this same pattern for consistency and maintainability.

---

### 3. **Not Using Shared `MarkdownNoteForm` Component**

The PR duplicates the entire note form logic in `app/components/location/notes/new.tsx` (133 lines) instead of using the **existing shared** `MarkdownNoteForm` component from `app/components/notes/markdown-note-form.tsx`.

**How asset notes do it** (`app/components/assets/notes/new.tsx`):

```tsx
import { MarkdownNoteForm } from "~/components/notes/markdown-note-form";

export const NewNote = ({
  fetcher,
}: {
  fetcher: FetcherWithComponents<any>;
}) => {
  const params = useParams();
  return (
    <MarkdownNoteForm
      fetcher={fetcher}
      action={`/assets/${params.assetId}/note`}
      formId="NewQuestionWizardScreen"
      editingAtom={isEditingAtom}
    />
  );
};
```

Location notes should be ~10 lines, not 133.

---

### 4. **Missing CSV Export Route**

Asset and booking notes both have CSV export routes:

- `/assets/:assetId/activity.csv`
- `/bookings/:bookingId/activity.csv`

Location notes are missing this functionality - there's no `/locations/:locationId/activity.csv` route.

The "Export activity CSV" button that exists in asset/booking notes components would need this endpoint.

---

### 5. **Inconsistent Date Formatting**

**Asset/Booking notes** use the `<DateS />` component with `includeTime` for timezone-aware client-side formatting:

```tsx
<Tag>
  <DateS date={note.createdAt} includeTime />
</Tag>
```

**Location notes** use pre-formatted `dateDisplay` string from the server:

```tsx
<Tag>{note.dateDisplay}</Tag>
```

While this works, it's inconsistent with the rest of the app and doesn't leverage the `DateS` component's locale/timezone handling.

---

## ⚠️ Moderate Issues

### 6. **Duplicated Schema Export**

The `NewLocationNoteSchema` is defined in `app/components/location/notes/new.tsx`, but there's already a shared `MarkdownNoteSchema` in `app/components/notes/markdown-note-form.tsx`. This creates duplication.

### 7. **Missing Export Button in LocationNotes Component**

The `LocationNotes` component (`app/components/location/notes/index.tsx`) doesn't include the "Export activity CSV" button that exists in both `Notes` (asset) and `BookingNotes` components:

```tsx
{
  hasNotes ? (
    <Button
      to={`/locations/${location.id}/activity.csv`}
      variant="secondary"
      className={
        "absolute right-0 top-[-58px] hidden px-2 py-1 text-sm md:inline-flex"
      }
      download
      reloadDocument
    >
      Export activity CSV
    </Button>
  ) : null;
}
```

### 8. **Optimistic UI Implementation Differs**

The optimistic UI pattern in location notes is simpler but different from asset/booking notes. Asset/booking notes create a full `NoteWithUser` object and render it through the shared `Note` component, while location notes manually render optimistic content with inline JSX.

---

## ✅ What's Done Well

1. **Schema is correct** - `LocationNote` model properly mirrors `Note` and `BookingNote` with the same fields and relations
2. **Service layer is good** - `location-note/service.server.ts` follows the same patterns as `note/service.server.ts` and `booking-note/service.server.ts`
3. **Permissions are properly configured** - `locationNote` entity added to permission data
4. **Markdoc tags are used correctly** in system notes - The location service uses `wrapUserLinkForNote`, `wrapAssetsWithDataForNote`, `wrapKitsWithDataForNote` properly for activity logging
5. **Test coverage exists** - Tests for routes, services, and components

---

## 📋 Summary

| Issue                | Severity     | Description                                                                                        |
| -------------------- | ------------ | -------------------------------------------------------------------------------------------------- |
| Switch `when` props  | **CRITICAL** | All notes render as UPDATE type - COMMENT notes lose author info and delete buttons                |
| Duplicate components | HIGH         | Creates separate `LocationNoteItem` and form instead of using shared `Note` and `MarkdownNoteForm` |
| Missing CSV export   | MEDIUM       | No `/locations/:id/activity.csv` route (exists for assets/bookings)                                |
| Date formatting      | LOW          | Uses pre-formatted string instead of `<DateS />` component                                         |

---

## 🔧 Recommendations

1. **Fix the Switch component bug immediately** - This is a P0 that breaks note type differentiation
2. **Refactor to use shared components**:
   - Use `Note` from `~/components/assets/notes/note`
   - Use `MarkdownNoteForm` from `~/components/notes/markdown-note-form`
3. **Add CSV export route** - Create `/locations/$locationId.activity[.csv].ts`
4. **Use `DateS` component** for consistent date formatting
5. **Add Export button** to `LocationNotes` component

---

This PR needs significant rework before it's ready to merge. The core functionality (markdoc tags, activity logging) is implemented correctly, but the UI layer duplicates existing code and has a critical rendering bug.
