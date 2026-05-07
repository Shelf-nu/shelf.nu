---
description: Prevent React re-render storms and component remount loops
globs:
  - "apps/webapp/app/routes/**/*.tsx"
  - "apps/webapp/app/components/**/*.tsx"
---

# React Render Stability

Lessons extracted from production hotfixes (PRs #2511, #2513, #2514).

## The Core Problem

TanStack Table's `flexRender` treats a different function reference as a
different component type. When function identity changes on every render,
React unmounts and remounts the entire subtree — causing:

- Image fetch storms (thousands of aborted requests)
- Radix tooltip ref churn → "Maximum update depth exceeded"
- DOM teardown errors and crashed apps

## Rules

### 1. Hoist Column Definitions to Module Scope

```typescript
// ❌ Bad — columns array rebuilt on every render
function MyContent({ rows }) {
  const columns: ColumnDef<Row>[] = [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => <span>{row.original.name}</span>, // new fn each render
    },
  ];
  return <ReportTable columns={columns} data={rows} />;
}

// ✅ Good — stable identity at module scope
const COLUMNS: ColumnDef<Row>[] = [
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => <span>{row.original.name}</span>,
  },
];

function MyContent({ rows }) {
  return <ReportTable columns={COLUMNS} data={rows} />;
}
```

### 2. If Columns Need Props, Use useMemo

```typescript
// ✅ When columns close over props, memoize with deps
function MyContent({ rows, maxValue }) {
  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      {
        accessorKey: "progress",
        cell: ({ row }) => <ProgressBar value={row.original.value} max={maxValue} />,
      },
    ],
    [maxValue] // Only rebuild when maxValue changes
  );
  return <ReportTable columns={columns} data={rows} />;
}
```

### 3. Hoist Complex Column Headers to Named Components

```typescript
// ❌ Bad — inline function header with Radix tooltip
{
  id: "avgDuration",
  header: () => (
    <span className="flex items-center gap-1">
      Avg Duration
      <InfoTooltip content="..." /> {/* Radix ref churn! */}
    </span>
  ),
}

// ✅ Good — stable component identity
function AvgDurationHeader() {
  return (
    <span className="flex items-center gap-1">
      Avg Duration
      <InfoTooltip content="..." />
    </span>
  );
}

// In columns:
{ id: "avgDuration", header: AvgDurationHeader }
```

### 4. useCallback for Row Click Handlers

```typescript
// ❌ Bad — new function on every render
function ReportPage() {
  const navigate = useNavigate();

  const handleRowClick = (row: Row) => {
    navigate(`/assets/${row.id}`);
  };

  return <Content onRowClick={handleRowClick} />;
}

// ✅ Good — stable callback identity
function ReportPage() {
  const navigate = useNavigate();

  const handleRowClick = useCallback(
    (row: Row) => {
      navigate(`/assets/${row.id}`);
    },
    [navigate]
  );

  return <Content onRowClick={handleRowClick} />;
}
```

### 5. Don't Change Global Layout for One Feature

```typescript
// ❌ Bad — changing parent flex affects ALL children
<main className="flex h-dvh w-full flex-col overflow-auto">
  {children} {/* Every child's layout changes! */}
</main>

// ✅ Good — scope layout changes to the specific route
<main className="h-dvh w-full overflow-auto">
  {children}
</main>

// In the specific route that needs flex:
<div className="flex h-full flex-col">
  <Header />
  <Content className="flex-1" />
</div>
```

### 6. Fix Server-Side, Not Client-Side Fallbacks

```typescript
// ❌ Bad — client-side placeholder fallback (hotfix)
// Shows placeholder when image fails, but doesn't fix the URL

// ✅ Good — re-sign expired URLs in the loader
export async function loader() {
  const rows = await fetchReportRows();
  // Refresh expired Supabase signed URLs server-side
  await refreshExpiredReportThumbnails(rows, organizationId);
  return { rows };
}
```

## When You Fix One, Fix All Similar

If you find a render stability issue in one component, check ALL similar
components. PR #2514 applied the same hoist-columns pattern to 6 report
components, not just the one that was broken.
