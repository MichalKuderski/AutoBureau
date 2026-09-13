# Pellum brand and domain implementation

Founder-approved product name: **Pellum** (PELL-um). Tagline: **A little less to carry.**

Selected domain: **usepellum.com**. Vercel's read-only availability check on September 12, 2026 UTC returned available, $11.25 USD for one year. getpellum.com had the same quote; pellum.com was unavailable. No purchase, renewal quote, DNS change or ownership claim is implied. Prefer one canonical .com with the full product name over hyphens, a feature-limited suffix or an unpriced aftermarket acquisition. This is a judgment about practical tradeoffs, not a guarantee against future naming problems.

Existing uses require clearance: [Pellum sauna heaters](https://pellum.ee/en/home/) and [Ennis Pellum technology consulting](https://jaxcpa.com/services/technology-consulting/). Search-engine absence of a household app is not trademark clearance. Screen the similar-sounding Vellum mark and the relevant software/services markets before public adoption.

## Name map

- Product/UI/metadata/manifest/new customer-facing copy: Pellum.
- Existing package imports, database names, migrations, cookie names, CSRF headers, problem-type URIs, theme storage key, bootstrap namespace and infrastructure IDs: retain AutoBureau identifiers for compatibility.
- Historical founding principles, ADRs, PR #4 and old evidence: retain original text. This map explains the current display name without rewriting history.
- Stable staging URL: keep autobureau-staging.vercel.app until a separately approved DNS release. APP_ORIGIN must continue to describe the actual deployed origin.
- Provider sender display name and Stripe test-product label: Pellum when configuring those providers. Keep actual verified sender addresses and provider resource IDs; never invent a deliverable address at an unowned domain.

## Visual system

Evergreen #275c48; warm canvas #f7f6f2; white surfaces; ink #16201f; secondary #4a5a58; tertiary #596d65. Existing semantic warning/error/success colors remain distinct from brand color. System sans for controls/body and editorial system serif for headings. Shared page-fold P mark, one type scale and spacing/radius tokens. Dark mode and reduced-motion behavior remain supported. Brand changes do not imply processing, encryption, reminder or billing functionality that has not been verified.

## Release work still required

Inspect every route/control at desktop and mobile, verify contrast and focus, add raster install icons/social card, verify sender/templates in staging, and confirm public/legal copy against the implemented data lifecycle. The manifest alone does not prove installability, offline support or push readiness.
