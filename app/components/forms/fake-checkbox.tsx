export const FakeCheckbox = ({ checked }: { checked: boolean }) =>
  checked ? (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="0.5" y="0.5" width="19" height="19" rx="5.5" fill="#FEF6EE" />
      <path
        d="M14.6668 6.5L8.25016 12.9167L5.3335 10"
        stroke="#EF6820"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="0.5" y="0.5" width="19" height="19" rx="5.5" stroke="#EF6820" />
    </svg>
  ) : (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="0.5" y="0.5" width="19" height="19" rx="5.5" fill="white" />
      <rect x="0.5" y="0.5" width="19" height="19" rx="5.5" stroke="#D0D5DD" />
    </svg>
  );
