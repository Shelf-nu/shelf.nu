/**
 * THROWAWAY — exists only to exercise the react-doctor PR check.
 *
 * Intentionally introduces:
 *   - 1 error    → react-doctor/no-derived-state-effect (useState mirroring
 *                  a prop via useEffect)
 *   - 1 warning  → jsx-a11y/no-autofocus
 *   - 1 warning  → react-doctor/no-array-index-as-key
 *
 * This file is NOT imported anywhere. It will be reverted before the test
 * PR is closed. Do not merge.
 */

import { useEffect, useState } from "react";

type Props = { value: string };

export function ReactDoctorCITest({ value }: Props) {
  const [mirrored, setMirrored] = useState(value);

  // no-derived-state-effect: mirroring a prop into state via useEffect.
  useEffect(() => {
    setMirrored(value);
  }, [value]);

  const items = ["a", "b", "c"];

  return (
    <div>
      {/* jsx-a11y/no-autofocus warning */}
      <input autoFocus />
      {items.map((item, i) => (
        // no-array-index-as-key warning
        <span key={i}>
          {item} {mirrored}
        </span>
      ))}
    </div>
  );
}
