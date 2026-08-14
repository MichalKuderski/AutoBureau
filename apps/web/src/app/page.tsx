import { LandingScreen } from "./landing-screen";

/**
 * No page-level metadata: the root layout's default title and description are
 * already written for this page, and overriding them here would put the template
 * suffix on the one page that shouldn't carry it.
 */
export default function Home() {
  return <LandingScreen />;
}
