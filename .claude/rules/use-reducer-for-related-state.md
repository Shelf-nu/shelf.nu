---
description: Use useReducer when multiple useState values change together or form a single state machine
globs: ["apps/webapp/**/*.tsx", "apps/webapp/**/*.ts"]
---

When a component has multiple `useState` calls that mutate together or
represent transitions of one state machine, consolidate them into a
`useReducer` with a typed action union. Coupled transitions become
atomic dispatches and the state flow is easier to reason about.

Reach for `useReducer` when any of these are true:

- 3+ useStates that change together in the same handler
- One handler always updates several pieces of state at once
- The state forms a state machine (e.g., loading → success/error)

Keep `useState` for genuinely independent values (e.g., a single
boolean toggling visibility). Use Jotai atoms when state is shared
across components.

```typescript
// ❌ Bad — coupled transitions split across many useStates
const [isLoading, setIsLoading] = useState(true);
const [isError, setIsError] = useState(false);
const [isOpen, setIsOpen] = useState(false);

// ✅ Good — coupled transitions expressed as a single dispatch
type State = { isLoading: boolean; isError: boolean; isOpen: boolean };
type Action =
  | { type: "load_success" }
  | { type: "load_error" }
  | { type: "open" }
  | { type: "close" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "load_success":
      return { ...state, isLoading: false, isError: false };
    case "load_error":
      return { ...state, isLoading: false, isError: true };
    case "open":
      return { ...state, isOpen: true };
    case "close":
      return { ...state, isOpen: false };
  }
}

const [state, dispatch] = useReducer(reducer, {
  isLoading: true,
  isError: false,
  isOpen: false,
});
```
