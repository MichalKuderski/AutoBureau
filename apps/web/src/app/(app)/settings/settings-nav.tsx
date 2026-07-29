"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const SECTIONS = [
  { href: "/settings", label: "Household" },
  { href: "/settings/profile", label: "Your profile" },
  { href: "/settings/notifications", label: "Notifications" },
  { href: "/settings/billing", label: "Plan & billing" },
  { href: "/settings/privacy", label: "Privacy & data" },
] as const;

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Settings sections" className="lg:w-52 lg:shrink-0">
      <ul className="flex gap-1 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
        {SECTIONS.map((s) => {
          const active = pathname === s.href;
          return (
            <li key={s.href} className="shrink-0">
              <Link
                href={s.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "block rounded-md px-3 py-2 text-sm transition-colors whitespace-nowrap",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                  active
                    ? "bg-accent-soft font-medium text-accent"
                    : "text-ink-secondary hover:bg-surface-sunken hover:text-ink",
                )}
              >
                {s.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
