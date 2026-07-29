import { PageHeader } from "@/components/patterns/page-header";
import { SettingsNav } from "./settings-nav";

/**
 * Settings uses a nested layout so the section list persists across navigation —
 * the sub-navigation should never re-mount or lose scroll position when the panel
 * changes.
 */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader
        title="Settings"
        description="How AutoBureau works for your household."
      />
      <div className="flex flex-col gap-6 lg:flex-row lg:gap-10">
        <SettingsNav />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </>
  );
}
