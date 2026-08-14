"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/icon";
import { useHousehold } from "@/providers/household-provider";
import { initialsOf } from "@/lib/format";

export interface NavItem {
  href: string;
  label: string;
  icon: (props: { className?: string }) => React.ReactElement;
  /** Live count badge, e.g. obligations needing action. */
  badgeKey?: "actionNeeded" | "needsReview" | "unread";
}

/**
 * Navigation is ordered by how often a caregiver actually needs it, not by
 * information architecture tidiness: what needs doing, then what we know, then the
 * evidence behind it.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Today", icon: Icon.Dashboard },
  { href: "/obligations", label: "Obligations", icon: Icon.Obligations, badgeKey: "actionNeeded" },
  { href: "/documents", label: "Documents", icon: Icon.Documents, badgeKey: "needsReview" },
  { href: "/household", label: "Household", icon: Icon.Household },
  { href: "/calendar", label: "Calendar", icon: Icon.Calendar },
  { href: "/timeline", label: "Timeline", icon: Icon.Timeline },
];

const SECONDARY_ITEMS: NavItem[] = [
  { href: "/notifications", label: "Notifications", icon: Icon.Bell, badgeKey: "unread" },
  { href: "/settings", label: "Settings", icon: Icon.Settings },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav({
  onNavigate,
  showClose,
}: {
  onNavigate?: (() => void) | undefined;
  showClose?: boolean;
}) {
  const pathname = usePathname();
  const { household } = useHousehold();

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <div
          aria-hidden
          className="flex size-8 items-center justify-center rounded-md bg-accent text-accent-ink"
        >
          <Icon.Shield className="size-4.5" />
        </div>
        <span className="font-serif text-lg font-semibold tracking-tight">AutoBureau</span>
        {showClose ? (
          <button
            type="button"
            {...(onNavigate ? { onClick: onNavigate } : {})}
            aria-label="Close navigation"
            className="ml-auto rounded-sm p-1.5 text-ink-tertiary hover:bg-surface-sunken hover:text-ink"
          >
            <Icon.Close className="size-4" />
          </button>
        ) : null}
      </div>

      <HouseholdSwitcher />

      <nav aria-label="Main" className="flex-1 overflow-y-auto px-2 py-2">
        <ul className="flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) => (
            <li key={item.href}>
              <NavLink item={item} active={isActive(pathname, item.href)} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>

        <hr className="my-3 border-line" />

        <ul className="flex flex-col gap-0.5">
          {SECONDARY_ITEMS.map((item) => (
            <li key={item.href}>
              <NavLink item={item} active={isActive(pathname, item.href)} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex items-center gap-1 border-t border-line p-2">
        <Link
          href="/settings/profile"
          {...(onNavigate ? { onClick: onNavigate } : {})}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-surface-sunken"
        >
          <span
            aria-hidden
            className="flex size-7 items-center justify-center rounded-full bg-accent-soft text-2xs font-semibold text-accent"
          >
            {initialsOf(household.name)}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-ink-secondary">
            {household.name}
          </span>
        </Link>
        <SignOutButton />
      </div>
    </div>
  );
}

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: (() => void) | undefined;
}) {
  const IconComponent = item.icon;
  return (
    <Link
      href={item.href as never}
      {...(onNavigate ? { onClick: onNavigate } : {})}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-accent-soft text-accent"
          : "text-ink-secondary hover:bg-surface-sunken hover:text-ink",
      )}
    >
      <IconComponent className={cn("size-[18px]", active ? "text-accent" : "text-ink-tertiary")} />
      <span className="flex-1 truncate">{item.label}</span>
    </Link>
  );
}

/**
 * Sign out.
 *
 * A link rather than a button on purpose: signing out is a navigation to the public
 * side of the product, and rendering it as one means middle-click and "open in new
 * tab" behave the way a person expects. Killing the refresh token is the server's
 * half of this (doc 06 §1) and arrives with the session wiring.
 */
function SignOutButton() {
  return (
    <Link
      href="/sign-in"
      aria-label="Sign out"
      title="Sign out"
      className="shrink-0 rounded-md p-2 text-ink-tertiary transition-colors hover:bg-surface-sunken hover:text-ink"
    >
      <Icon.Logout className="size-[18px]" />
    </Link>
  );
}

function HouseholdSwitcher() {
  const { household } = useHousehold();
  const memberCount = household.members.length;
  return (
    <div className="mx-2 mb-1 rounded-md border border-line bg-surface-sunken/60 px-3 py-2">
      <p className="truncate text-sm font-medium text-ink">{household.name}</p>
      <p className="text-2xs text-ink-tertiary">
        {memberCount} {memberCount === 1 ? "member" : "members"} ·{" "}
        {household.plan === "premium" ? "Premium" : "Free"}
      </p>
    </div>
  );
}

export function MobileTabBar({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="grid grid-cols-4">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          const IconComponent = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href as never}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-1 py-2.5 text-2xs font-medium transition-colors",
                  active ? "text-accent" : "text-ink-tertiary",
                )}
              >
                <IconComponent className="size-5" />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
