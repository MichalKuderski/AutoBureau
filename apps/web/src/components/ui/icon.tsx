import { cn } from "@/lib/cn";

/**
 * Icon set.
 *
 * Hand-rolled rather than pulled from a library: this product needs ~20 icons, and a
 * dependency would ship hundreds. Every icon is a 24px grid, 1.7 stroke, currentColor,
 * and `aria-hidden` by default — icons are decorative unless a caller labels them.
 */

export type IconProps = {
  className?: string | undefined;
  title?: string | undefined;
};

function Svg({ className, title, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-5 shrink-0", className)}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export const Icon = {
  Dashboard: (p: IconProps) => (
    <Svg {...p}>
      <path d="M3 12.5 12 4l9 8.5" />
      <path d="M5.5 10.8V20h13v-9.2" />
    </Svg>
  ),
  Obligations: (p: IconProps) => (
    <Svg {...p}>
      <rect x="3.5" y="4.5" width="17" height="16" rx="2.5" />
      <path d="M8 3v3M16 3v3M3.5 9.5h17M8.5 14l2 2 4-4" />
    </Svg>
  ),
  Documents: (p: IconProps) => (
    <Svg {...p}>
      <path d="M14 3.5H7.5A2 2 0 0 0 5.5 5.5v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z" />
      <path d="M14 3.5V8h4.5M9 13h6M9 16.5h4" />
    </Svg>
  ),
  Household: (p: IconProps) => (
    <Svg {...p}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <circle cx="17" cy="10" r="2.3" />
      <path d="M15 20c0-2.2 1-3.6 2-4.2 2 .5 3.5 2.2 3.5 4.2" />
    </Svg>
  ),
  Timeline: (p: IconProps) => (
    <Svg {...p}>
      <path d="M6 3.5v17" />
      <circle cx="6" cy="8" r="2" />
      <circle cx="6" cy="16" r="2" />
      <path d="M10 8h10M10 16h7" />
    </Svg>
  ),
  Calendar: (p: IconProps) => (
    <Svg {...p}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M8 3v4M16 3v4M3.5 10h17" />
    </Svg>
  ),
  Search: (p: IconProps) => (
    <Svg {...p}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </Svg>
  ),
  Bell: (p: IconProps) => (
    <Svg {...p}>
      <path d="M18 8.5a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16s-2-1.5-2-6.5Z" />
      <path d="M10.3 19a2 2 0 0 0 3.4 0" />
    </Svg>
  ),
  Settings: (p: IconProps) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
    </Svg>
  ),
  Plus: (p: IconProps) => (
    <Svg {...p}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  ),
  Upload: (p: IconProps) => (
    <Svg {...p}>
      <path d="M12 15.5V4M8 7.5 12 3.5l4 4" />
      <path d="M4 15v3.5A2 2 0 0 0 6 20.5h12a2 2 0 0 0 2-2V15" />
    </Svg>
  ),
  Camera: (p: IconProps) => (
    <Svg {...p}>
      <path d="M3.5 8.5A2 2 0 0 1 5.5 6.5h1.8l1.2-2h6.8l1.2 2h1.8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2Z" />
      <circle cx="12" cy="13" r="3.5" />
    </Svg>
  ),
  Check: (p: IconProps) => (
    <Svg {...p}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Svg>
  ),
  Clock: (p: IconProps) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5.3l3.2 2" />
    </Svg>
  ),
  Alert: (p: IconProps) => (
    <Svg {...p}>
      <path d="M12 8.5v4.5M12 16.5h.01" />
      <path d="M10.3 3.9 2.4 17.5A1.9 1.9 0 0 0 4 20.4h16a1.9 1.9 0 0 0 1.6-2.9L13.7 3.9a1.9 1.9 0 0 0-3.4 0Z" />
    </Svg>
  ),
  Shield: (p: IconProps) => (
    <Svg {...p}>
      <path d="M12 3 5 6v5.5c0 4.3 2.9 8.3 7 9.5 4.1-1.2 7-5.2 7-9.5V6Z" />
      <path d="m9.2 12 2 2 3.6-3.6" />
    </Svg>
  ),
  Sparkle: (p: IconProps) => (
    <Svg {...p}>
      <path d="M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6-5.5-1.7L10.3 9Z" />
    </Svg>
  ),
  ChevronRight: (p: IconProps) => (
    <Svg {...p}>
      <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />
    </Svg>
  ),
  ChevronDown: (p: IconProps) => (
    <Svg {...p}>
      <path d="m5.5 9.5 6.5 6.5 6.5-6.5" />
    </Svg>
  ),
  Close: (p: IconProps) => (
    <Svg {...p}>
      <path d="m6 6 12 12M18 6 6 18" />
    </Svg>
  ),
  Menu: (p: IconProps) => (
    <Svg {...p}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Svg>
  ),
  Wallet: (p: IconProps) => (
    <Svg {...p}>
      <path d="M3.5 8.5A2 2 0 0 1 5.5 6.5h13a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" />
      <path d="M3.5 10.5h17M16 14.5h1.5" />
    </Svg>
  ),
  Sun: (p: IconProps) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" />
    </Svg>
  ),
  Moon: (p: IconProps) => (
    <Svg {...p}>
      <path d="M20 14.2A8.5 8.5 0 0 1 9.8 4a8.5 8.5 0 1 0 10.2 10.2Z" />
    </Svg>
  ),
  Logout: (p: IconProps) => (
    <Svg {...p}>
      <path d="M9.5 20.5h-4a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h4" />
      <path d="M15.5 16.5 20 12l-4.5-4.5M20 12H9" />
    </Svg>
  ),
};
