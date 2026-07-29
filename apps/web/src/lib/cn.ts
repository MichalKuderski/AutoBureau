import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Class composition with conflict resolution. `twMerge` ensures a caller's
 * `className` always beats a component's defaults — without it, prop-based
 * overrides silently lose to whichever class the bundler emitted last.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
