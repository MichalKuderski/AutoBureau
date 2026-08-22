"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/icon";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/api-client";
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
 * Sign out (blueprint P0-02).
 *
 * A button, not a link. The previous version navigated to `/sign-in` and called nothing,
 * so the cookies stayed valid and the refresh token stayed live at the provider — a
 * person who signed out on a shared family device left the household's documents open to
 * whoever used it next. Signing out is a state mutation, and the loss the old comment was
 * protecting (middle-click, open-in-new-tab) is the correct loss for an action.
 *
 * WHAT COUNTS AS SUCCESS IS THE SERVER'S DEFINITION, NOT THIS COMPONENT'S.
 * `POST /v1/auth/sign-out` answers 204 and expires both cookies whenever it runs at all,
 * including when the provider's own `/logout` fails — `provider.signOut` swallows that by
 * design, because a user who pressed sign-out must end up signed out of this origin even
 * when the provider is unreachable. So a 204 is proof the local session is gone.
 *
 * Anything else is not. A 403 (CSRF) or 503 (unconfigured) returns before any cookie is
 * cleared, and a network failure never reached the server, so those keep the user where
 * they are and say so. Navigating to `/sign-in` on a failed request would be the same
 * false-success this task exists to remove.
 */
export function SignOutButton() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [pending, setPending] = useState(false);

  const signOut = async () => {
    if (pending) return;
    setPending(true);
    try {
      await apiFetch<void>("/auth/sign-out", { method: "POST" });
    } catch {
      // The session may well still be live; the only honest thing is to stay put.
      setPending(false);
      toast({
        tone: "critical",
        title: "We couldn't sign you out",
        description: "You're still signed in. Check your connection and try again.",
      });
      return;
    }

    // The cookies are gone, so anything cached under them is stale by definition —
    // dropping it here stops a household's data outliving its session in memory.
    queryClient.clear();
    // `replace` so the authenticated page is not a Back target, and `refresh` to discard
    // the router cache, which would otherwise re-render the last authenticated payload
    // client-side without asking the server. Same pairing the sign-in form already uses.
    router.replace("/sign-in");
    router.refresh();
    // `pending` deliberately stays true: the component is unmounting, and a second press
    // during navigation would post again with cookies that no longer exist.
  };

  return (
    <button
      type="button"
      onClick={() => void signOut()}
      disabled={pending}
      aria-busy={pending || undefined}
      aria-label={pending ? "Signing out…" : "Sign out"}
      title="Sign out"
      className="shrink-0 rounded-md p-2 text-ink-tertiary transition-colors hover:bg-surface-sunken hover:text-ink disabled:pointer-events-none disabled:opacity-60"
    >
      {pending ? (
        <Spinner className="size-[18px]" />
      ) : (
        <Icon.Logout className="size-[18px]" />
      )}
    </button>
  );
}

/**
 * The active household, and — when there is more than one — the way to change it
 * (blueprint P1-03).
 *
 * A single membership renders exactly what it always did: a label, not a control. There
 * is nothing to switch to, and a dropdown that opens onto one option is a worse label.
 *
 * `select()` writes a preference and refreshes. It sets no local state, so what this
 * shows is always the household the *server* resolved on the last render — a selection
 * the server refuses can never leave the sidebar naming a household the person cannot
 * actually see. That is also why there is no pending state: the refresh is the feedback.
 *
 * P2-04 owns the real switcher — search, keyboard menu, per-household detail. This is the
 * minimum that makes multi-household usable, and deliberately no more.
 */
function HouseholdSwitcher() {
  const { household, households, select } = useHousehold();
  const memberCount = household.members.length;
  const summary = `${memberCount} ${memberCount === 1 ? "member" : "members"} · ${
    household.plan === "premium" ? "Premium" : "Free"
  }`;

  if (households.length <= 1) {
    return (
      <div className="mx-2 mb-1 rounded-md border border-line bg-surface-sunken/60 px-3 py-2">
        <p className="truncate text-sm font-medium text-ink">{household.name}</p>
        <p className="text-2xs text-ink-tertiary">{summary}</p>
      </div>
    );
  }

  return (
    <div className="mx-2 mb-1 rounded-md border border-line bg-surface-sunken/60 px-3 py-2">
      <label htmlFor="household-switcher" className="sr-only">
        Active household
      </label>
      <select
        id="household-switcher"
        value={household.id}
        onChange={(e) => select(e.target.value)}
        className="w-full truncate bg-transparent text-sm font-medium text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        {households.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
      <p className="text-2xs text-ink-tertiary">{summary}</p>
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
