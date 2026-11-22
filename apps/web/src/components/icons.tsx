/** Small line icons (1.8 px stroke, currentColor) used instead of emoji so controls look the same on every platform. */
const base = {
  viewBox: '0 0 24 24',
  width: 18,
  height: 18,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

export const CameraIcon = () => (
  <svg {...base}>
    <path d="M4 8h3l1.5-2h7L17 8h3v11H4z" />
    <circle cx="12" cy="13.5" r="3.5" />
  </svg>
);
export const ImageIcon = () => (
  <svg {...base}>
    <rect x="3.5" y="5" width="17" height="14" rx="1.5" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="M20.5 16l-5-5-8.5 8" />
  </svg>
);
export const MicIcon = () => (
  <svg {...base}>
    <rect x="9" y="3.5" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
  </svg>
);
export const StopIcon = () => (
  <svg {...base} fill="currentColor" stroke="none">
    <rect x="7" y="7" width="10" height="10" rx="1.5" />
  </svg>
);
export const PinIcon = () => (
  <svg {...base}>
    <path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </svg>
);
