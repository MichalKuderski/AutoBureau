# AutoBureau — Competitive Deep-Dive

**Date:** 2026-07-28 · **Method:** live web research (July 2026) + historical corpus. Live-verified claims carry a °; everything else is training-knowledge and should be spot-verified before appearing in a deck. **Mandate honored:** brutal honesty, brilliant well-funded competitors assumed, optimism excluded.
**Feeds:** the blueprint's standing incumbent-watch track, the seed deck's competition slide, and the moat directive (§8).

---

## Part I — The corpus: everyone who touched this problem

Fate legend: † dead · ⇣ pivoted/faded · ⌂ acquired (small) · ✓ alive · ★ alive and relevant to us

### 1. Consumer life-admin & document vaults (our direct lineage)

| Company | What they actually solved | Model | Fate | The lesson for us |
|---|---|---|---|---|
| **Manilla** (Hearst, 2011–14) | Bills + accounts + docs + reminders in one place — *literally AutoBureau v0.5* | free, hoped-for monetization | † | Award-winning UX, ~700k users, **no willingness to pay and no monetization path**. Aggregation-of-reminders alone is not a business |
| **FileThis** (2010–23) | Auto-fetch statements/docs from institutions into a vault | consumer + API | † | Fetching-into-a-folder is plumbing; nobody pays for a tidier pile |
| **Doxo** (2008–) | Started as "digital file cabinet for bills" | pivoted to bill *pay* | ⇣✓ | Survived only by moving from *record* to *transaction* — action monetizes, storage doesn't |
| **Shoeboxed / Neat** | Receipt digitization | scan-service subscriptions | ⌂/⇣ | OCR-as-product commoditized a decade before LLMs finished the job |
| **Evernote** | "Remember everything" | freemium | ⇣ (acq. Bending Spoons) | Memory without obligations = a write-only archive; engagement decays structurally |
| **Jumbo** (2019–22) | Privacy/digital-footprint cleanup | subscription | † | Adjacent "act on your behalf" consumer sub that couldn't retain |
| **Trustworthy°** (2020–) | "The Family Operating System®" — secure family document vault, estate-adjacent | $  vault subscription; **distributes via bank marketplaces (Q2)** | ★ | Closest *positioning* competitor. $15M Series A (2022), **no Series B four years later**° — vault-first stalls exactly where our thesis predicts (static record, no obligations engine, no action). Their bank-channel distribution is the validated part — copy that, not the product |
| **Everplans** | Estate/emergency document organization | B2B2C via advisors | ⌂ | The "in case I die" framing sells through *advisors*, not directly — channel lesson |
| **Yohana°** (Panasonic, 2021–Jan 2026) | Human concierge for family to-dos ("Yo Assistants") | ~$100+/mo subscription | **†** (closed Jan 30, 2026°) | The biggest fresh corpse in our category: even with Panasonic's balance sheet and Yoky Matsuoka, **human-hours-as-product didn't scale to viable unit economics**. Concierge is an instrument (our P0) and a QA layer — never the product |
| **Duckbill°** (2022–) | Task *execution* concierge: AI copilots + humans, chat-in tasks | $33M raised°, Forerunner-led; subscription; claims 95% monthly retention° | ★ | The strongest adjacent operator. Validates "do it for me" demand and hybrid AI+human ops. Unknown: unit economics of their human layer post-Yohana. They own the *task* plane; nobody owns the *standing* plane — but they could climb down into it |
| **Ohai.ai°** (Sheila Marcelo/Care.com, 2024–) | Family *calendar/logistics* AI ("household chief of staff") | $9.99/mo · $99/yr° | ★ | Same buyer (household manager/caregiver-adjacent), different plane (time/schedule, not standing/obligations). Their price point tests our $12 assumption |
| **Milo°** (YC W20, OpenAI-funded°) | Parent copilot for the "invisible load," SMS-first, human-in-loop | subscription | ★ | Same emotional territory ("mental load"), logistics plane. OpenAI Startup Fund's presence here = the big labs see the household |
| **Cozi / OurHome / Maple / Hearth** | Family calendars & chores | freemium/hardware | ✓ (modest) | The calendar plane is crowded and low-value; never enter it |

### 2. Fintech / found-money (the money plane)

| Company | Solved | Model | Fate | Lesson |
|---|---|---|---|---|
| **Mint** (2007–24) | See all your money in one place | free → ads/leads | † | 20M+ users, killed anyway: **engagement without a transaction or subscription engine is worthless at scale**. The definitive graveyard headstone |
| **Truebill → Rocket Money°** | Kill zombie subscriptions, negotiate bills | freemium + % of savings (35–60%°) + premium $7–14/mo° | ★ (won) | The category's one big winner: **automatic ingestion (Plaid) + found-money anchor + action**. Our most symmetric threat (§Part III) |
| **Trim** | Same as Truebill | % of savings | ⌂ (OneMain) | Two players proved the wedge; only the one with better consumer brand survived independent |
| **Cushion°** (2016–24) | Bank-fee refunds, then BNPL aggregation | % of refunds → infra pivot | **†** (Dec 2024°, $21.6M raised°) | Narrow found-money tools hit a ceiling; a late infra pivot ("Plaid for BNPL") couldn't save it. Found money is an *anchor*, not a company |
| **Digit** | Auto-savings | subscription | ⌂ (Oportun, later shuttered) | Passive-value fintechs get acquired into oblivion |
| **Copilot Money / Monarch** | Post-Mint budgeting | paid subscription | ✓ | Proof consumers *will* pay ($8–15/mo) for money software post-Mint — WTP exists when the product is loved |
| **Cleo** | Money assistant with personality (chat-first) | subscription | ✓ | Chat-first + personality retains *young* users; different demographic physics than ours |

### 3. InsurTech (the policy slice)

| Company | Fate | Lesson |
|---|---|---|
| **Marble°** (insurance wallet + rewards) | ⌂ The Zebra, 2024° | An insurance *wallet* alone was worth an acqui-price, not a company — became a comparison site's feature. Single-vertical standing ledgers are features |
| **Gabi / Policygenius** | ⌂ (Experian / Zinnia) | Policy *shopping* monetizes (lead-gen $50–150) but is a transaction business, not a record business — this is the referral revenue our ADR-011 deliberately deferred |
| **Jerry** | ✓ | Car-insurance re-shopping at renewal works as a business — the *renewal moment* is monetizable; we will own thousands of renewal moments |

### 4. Healthcare (the medical-records slice)

PicnicHealth (✓, records aggregation monetized via research — B2B2C data economics, consent-based), CareZone († assets → Walmart — meds/caregiving organizer couldn't monetize direct), Ciitizen (⌂, records-under-patient-control sold into clinical research). **Lesson:** patient-controlled record aggregation only ever monetized through *institutional* buyers, never the consumer. Our medical_bill scope stays narrow (bills/EOBs as obligations), never "health records" — that's a licensed swamp with its own dead.

### 5. LegalTech

DoNotPay (⇣ — FTC-fined 2024 for overclaiming "AI lawyer"; cautionary tale: **overclaim AI capability in a consumer-protection domain and the FTC is your churn**), Trust & Will / FreeWill (✓ — estate documents sell at *life events*, largely through partners), Atticus/Hello Divorce (✓ niche). **Lesson:** legal-adjacent admin monetizes at event moments through trusted channels; claims discipline is regulatory survival.

### 6. GovTech & state-run rails (the counterfactual that proves the thesis)

| System | Status | Lesson |
|---|---|---|
| **India DigiLocker** | ✓ state-run, hundreds of millions of users | Where the *state issues documents into the wallet*, the wallet wins. The government-rails version of AutoBureau works — in countries that built it |
| **Estonia X-Road / Singapore Myinfo** | ✓ | Same: state-integrated personal data = solved problem, no startup needed |
| **EU eIDAS 2.0 / EUDI Wallet°** | mandatory issuance by Dec 2026°; private-sector acceptance by late 2027° | **Europe is becoming a DigiLocker.** The EU version of our identity/document layer will be state-supplied — EU expansion must *build on* EUDI, never compete with it |
| **US: IRS Direct File°** | **† killed for 2026 season°** | The US federal government is *retreating* from consumer-admin simplification. The US white space is widening precisely because the state is exiting |
| **UK Verify** | † | State identity fails where issuance isn't tied to daily-use documents |
| **US mDL°** | 21 states + PR issuing°; CA ~1.7M active°; Apple/Google Wallet ≈ a dozen states each° | The *identity credential* layer is being absorbed by platform wallets. Do not build identity; consume it (verification, not issuance) |

### 7. PKM & personal data lockers (the idealists' graveyard)

Solid/Inrupt (stalled — even Tim Berners-Lee couldn't make data-ownership-as-product move), digi.me/Mydex/HAT (†/⇣), Notion/Obsidian (✓ but a different job: thought, not obligations), Mem (⇣), Rewind → Limitless (⇣ pivot to hardware). **Lesson (the load-bearing one):** *a personal data store without consequences has no maintenance loop and no buyer. Every one died of entropy and abstraction.* Our reminder-as-freshness-probe design is the direct answer to this graveyard.

### 8. Personal CRM

Clay, Dex, Monica: all small. Relationships, like knowledge, lack enforced consequences — no deadline forces the record true. Same death, softer landing. Confirms: **obligations are the only personal data with a built-in maintenance loop.**

### 9. AI agents & assistants (the new weather system)

| Player | Status | Read |
|---|---|---|
| **OpenAI Operator → ChatGPT agent°; GPT-5.6 "work agents" (July 2026°)** | agent mode GA for consumers°; workspace agents for business° | Horizontal agents now book, browse, schedule, file. **They are session-based executors, not standing ledgers** — they re-derive your world each run. But they normalize the behavior we need (delegating admin to AI) and they compress the value of our *execution* layer's generic parts |
| **Gemini in Gmail°** | on-request subscription audit ("find my recurring charges, renewal dates")°; default AI summaries° | **The incumbent feature-flag is no longer hypothetical — it shipped.** Today it's *pull* (user must ask) and stateless. The day it becomes *push* + persistent is the day our reminder layer is sherlocked. Our answer must already be live: cross-provider standing + action + provenance |
| **Anthropic / Claude consumer agents** | ✓ | Same shape as above |
| Adept (⌂ Amazon), MultiOn (⇣), Humane († → HP), Rabbit (⇣) | — | Agent *hardware* and thin agent wrappers died fast; agent *capability* concentrated into the labs |
| **Lindy, Fyxer, Howie, and ~149 YC AI-assistant startups°** | ✓ swarm | Inbox/calendar/scheduling planes are saturated. **Nobody in the swarm is building the household standing ledger** — verified via YC directory sweep°: coaching, scheduling, legal-ops, sales — no obligations-ledger play found |

### 10. Enterprise document AI (the commoditization proof)

DocuSign (→ "Intelligent Agreement Management" — agreements-as-data for *companies*; the enterprise sibling of our thesis), Instabase/Hyperscience (IDP), Reducto/LlamaParse/frontier-model APIs. **Lesson:** extraction accuracy is a purchasable commodity sliding to zero margin — exactly as our OpenAI-VP seat predicted. Anyone whose moat is "we parse documents well" is already dead and doesn't know it.

---

## Part II — Synthesis: the ten questions across the corpus

**1. What were they actually solving?** Four planes, repeatedly: *money flows* (Mint→Rocket), *time/logistics* (Cozi→Ohai/Milo), *storage* (Manilla→Trustworthy), *task execution* (Yohana→Duckbill→ChatGPT agent). **The standing plane — the verified record of holdings/obligations/entitlements — has been attempted only as static storage, never as a live, consequence-bearing system.**

**2. Why did they succeed or fail?** The pattern is monotonous: **passive record-keepers died (no maintenance loop, no WTP); action-takers with automatic ingestion survived** (Rocket, Doxo-post-pivot, Jerry). Human-hour services died at scale (Yohana) or remain unproven (Duckbill's margin question). Free-with-hoped-monetization died (Mint, Manilla).

**3. Business models:** ads/leads on aggregated data (died or sold small) · consumer subscription (works only post-Mint, $8–15, when the product is loved: Copilot/Monarch/Ohai) · % of found money (works as *anchor*: Rocket; fails as *whole company*: Cushion, Trim) · B2B2C via banks/advisors (quietly works: Trustworthy°, Carefull°, Everplans) · state-funded (works, only where the state shows up).

**4. Why didn't anyone become the household OS?** Because every attempt entered on exactly one plane and had no gravity to pull in the others: money apps had no documents, vaults had no consequences, calendars had no authority, concierges had no compounding record. **The OS position requires an asset that makes each plane want to join it — that asset is the obligation-bearing ledger, and nobody built it.**

**5. Wrong assumptions (recurring):** "organized people will maintain it" (no); "users will pay to prevent" (no — they pay to *recover* and to *be relieved*); "aggregation is the product" (no — it's the prerequisite); "humans in the loop can be the product" (no — they're a bridge); "the graph/locker is valuable per se" (no — value = consequences).

**6. Correct assumptions (validated by survivors):** automatic ingestion is non-negotiable (Plaid made Rocket) · the household manager persona is real and reachable (Ohai/Milo/Duckbill all found her) · action monetizes · found money converts · bank/advisor channels distribute trust products cheaply · post-Mint, consumers pay for money-adjacent software they love.

**7. Technology limits then vs now:** document understanding needed per-format templates (now: frontier vision models, commodity) · email parsing was regex archaeology (now: LLM relevance + extraction) · agents couldn't act (now: browsing/executing agents are GA°) · voice/photo capture was lossy (now: solved) · per-user cost of "AI reading everything" was absurd (now: cents, still falling). **Manilla failed with 2012 technology; its problem statement was correct.**

**8. Regulatory changes that matter:** CFPB 1033 enjoined & being rewritten° (open-banking access may get fee-walled — a *threat* to Plaid-dependent plays and a reprieve-window for us since v1 skips transactions) · IRS Direct File dead° (US state retreat widens private space) · mDL/platform wallets scaling° (consume, don't build, identity) · eIDAS 2.0 deadline Dec 2026° (EU = build-on-EUDI later) · FTC active on AI overclaiming (DoNotPay°) and subscription dark patterns (our one-click cancel is compliance *and* positioning) · Google restricted-scope/CASA regime (annual cost of the inbox channel — budgeted in blueprint).

**9. Market changes:** Mint's death orphaned tens of millions of users and proved paid-is-the-model · Yohana's death just released the "handle my household" demand it validated · the sandwich generation is peaking demographically (caregiver wedge tailwind) · subscription sprawl made "what am I paying for" a universal itch · post-2023 AI product fatigue raised the bar: "AI-powered" is now a *suspicion*, not a pitch.

**10. AI-driven behavior change:** people now *forward things to an AI and expect it handled* — the behavior Manilla begged for is being trained daily by ChatGPT/Gemini · delegation of reading (inbox AI summaries default-on°) normalizes machine-read mail · chat-first expectations cut both ways (our no-chat v1 must feel deliberate, not missing) · and crucially: **users increasingly *trust but verify* AI claims — which is exactly the muscle our provenance-first UX serves.**

---

## Part III — Market map, landscape, threat tiers

### The planes map (who owns what)

```
  IDENTITY plane      → platform wallets + state (Apple/Google mDL°, EUDI°)   [closed to startups]
  MONEY-FLOW plane    → Rocket Money, Monarch/Copilot, banks                  [owned]
  TIME/LOGISTICS plane→ Ohai°, Milo°, Cozi, calendar AIs                      [crowded, low value]
  TASK-EXECUTION plane→ Duckbill°, ChatGPT agent°, Gemini, Claude             [labs will own generic]
  STORAGE plane       → Trustworthy°, Google Drive, iCloud                    [commodity, stalls at Series A°]
  STANDING plane      → ▓▓▓ EMPTY ▓▓▓ (obligations + entitlements + verified  [the white space]
                         holdings with provenance, freshness, and consequences)
```

### Threat tiers (brilliant, funded, already working — as instructed)

- **Tier 1 — Rocket Money.** Owns ingestion (bank), brand ("finds money"), and 5M+ paying users. One PM's roadmap away from "Rocket Docs & Deadlines." Our only defenses: move faster on the non-transactional standing (registrations, IDs, warranties, leases — invisible to bank feeds), and own the caregiver relationship they don't serve. **Clock: assume 18–24 months.**
- **Tier 2 — Google.** Gemini-in-Gmail already answers subscription-audit queries on demand°. The push-version (proactive renewal tracking) sherlocks our reminder layer for Gmail-borne facts. Defense: cross-provider + paper-borne + confirmed-not-inferred facts + action + a brand whose incentive is the user, not ads. **We survive as "the one whose business model is you."**
- **Tier 2 — OpenAI/Anthropic.** Agents commoditize generic execution°. Defense: agents are stateless per-session; our ledger is the context layer agents will *need* — position for interop (the ledger as the household MCP server, so to speak) rather than combat.
- **Tier 3 — Duckbill°/Ohai°/Milo°.** Same buyer, adjacent planes, could each add a ledger. Watch Duckbill especially: execution + a ledger = our Act II from the other direction. Defense: they'd have to *retreat* from their current value prop to build boring record infrastructure — attackers rarely climb down.
- **Tier 3 — Trustworthy°.** Same positioning words ("Family Operating System"), stalled product thesis°. Risk is brand-confusion more than product; their bank-channel is the thing to study°.
- **Tier 4 — Intuit/Apple/banks.** Slow, bundle-driven; respond to traction, not ideas.

### White space, stated precisely

**The live, consequence-bearing household standing ledger — cross-plane, provenance-backed, action-terminating — for the household manager/caregiver.** Everyone circles it: vaults store it statically°, money apps see its transactional shadow, calendars see its time shadow, agents could act on it but hold no record. The corpus shows *why* it's empty: it was technically infeasible before 2023 (Q7) and it looks like three bad businesses (storage + reminders + concierge) unless you build the compounding twin-ledger asset that unifies them — which is precisely the first-principles thesis.

---

## Part IV — Moat analysis: what brilliance and money cannot shortcut

Ranked by resistance-to-capital (what an unlimited-budget competitor still cannot buy):

1. **Time-series truth (Ledger A tenure).** A competitor can clone the software in a quarter; they cannot clone three years of a household's confirmed, corrected, resolved standing. *Cannot be bought — only accrued.*
2. **The outcome graph (Ledger B).** Procedural reality (what the DMV actually did, which cancellation path worked) is generated only by operating at volume over time. Money buys researchers; it does not buy 100k resolved obligations. *Cannot be bought — only operated into existence.*
3. **Caregiver authority infrastructure.** POA handling, consent structures, multi-member legal relationships, elder-financial-abuse safeguards (see Carefull's bank distribution°) — unglamorous, legally fiddly, exactly what a lab or a growth-stage fintech will not prioritize. *Could be bought, won't be — negative-glamour moat.*
4. **Bank/advisor distribution rails** (validated by Trustworthy°, Carefull°, Everplans): trust products sell through trusted channels; channel relationships compound and exclude. *Buyable but slow — first-mover matters.*
5. **The trust brand + audited safety record.** One earned "AutoBureau caught it" reputation in caregiver communities beats any ad budget; conversely this moat has a single point of failure (breach).
6. *(Deliberately not moats:)* extraction accuracy, prompts, model choice, UI polish, "AI" itself.

**The build-what-they-can't-replicate directive:** every sprint should deepen 1–3. Concretely — outcome capture on every resolution from day one (A-F3, already in PRD), the rulebook subsystem staffed like engineering (A-B2), and caregiver-authority features (consent, member-level permissions, POA document handling) treated as core product, not compliance chores. The generic parts (extraction, chat, scheduling) should be *thin and replaceable on purpose* — spend where capital can't follow.

## Part V — Lessons learned (the laws of this category)

1. **Storage dies; consequences compound.** (Manilla, FileThis, Evernote, every locker vs. Rocket, Doxo)
2. **Nobody maintains a record; records must maintain themselves.** Passive ingestion + freshness probes or death. (All of PKM)
3. **Prevention doesn't sell; recovery and relief do.** Anchor to found money and caregiver relief; deliver prevention as the retained substance.
4. **Humans-as-product don't scale; humans-as-bridge do.** (Yohana† vs. our concierge-as-instrument; Duckbill is the live experiment on the boundary)
5. **Free is fatal in this category.** (Mint, Manilla) Paid-and-loved beats free-and-huge.
6. **Single-plane wedges exit small.** (Marble°, Trim, Cushion°) The wedge must open onto the full standing ledger or it caps at an acqui-hire.
7. **Trust products distribute through trusted channels.** (Everplans, Carefull°, Trustworthy°) — banks/advisors/communities, not paid social.
8. **Overclaiming AI in consumer-protection domains is a regulatory event.** (DoNotPay°) Provenance-first isn't just UX; it's survival.
9. **Where the state builds the rails, ride them; where it retreats, replace it.** (DigiLocker/EUDI° vs. US Direct File death°)

## Part VI — Category risks (beyond company risks)

- **The stateless-agent paradigm risk (the deep one):** if lab agents become good enough to re-derive a household's state from raw sources *on demand, each time*, a curated ledger loses value. Honest counters: cost (re-derivation at frontier prices vs. a cached verified ledger), *verifiability* (agents hallucinate; a provenance ledger doesn't), liability (nobody sues a session; they sue a record-keeper — and that's a *business* we can insure and price), and facts that exist in no inbox (the census, paper mail, verbal knowledge). This risk is real and permanent; our answer must stay: *the ledger is the thing agents check against.*
- **Inbox-access policy risk:** Google tightening restricted scopes (or pricing them) could throttle the primary ingestion channel — mitigations: multi-channel by design, CASA budgeted, forwarding fallback preserved.
- **Open-banking fee walls** (1033 rewrite°) raise the future cost of the Act-II transaction channel.
- **AI-fatigue trust backlash:** "AI reads your documents" is a harder sell in 2026 than 2024; lead with guarantees, not AI.
- **Category-timing risk:** we may be 12 months early on WTP for the ledger per se — which is why the wedge monetizes *relief* now and the ledger compounds quietly underneath.

## Part VII — Opportunities that did not exist five years ago

1. Frontier vision models = Manilla's product finally buildable at consumer COGS.
2. Agent execution (GA°) = Act II's action rails don't require browser-automation R&D — only safety architecture, which we've already designed.
3. Mint's orphans + Yohana's diaspora° = a category's worth of demand with fresh scar tissue and no home.
4. Platform identity wallets° = verification infrastructure we consume instead of build.
5. AI-normalized delegation (Q10) = the forward-it-to-the-AI behavior is being trained for us daily, free.
6. The caregiving demographic peak + financial-caregiving products winning bank distribution° = our wedge has a validated channel.
7. Cheap embeddings + structured outputs = the eval-gated extraction pipeline is a solved engineering pattern, not research.
8. EUDI°/DigiLocker precedents = the *interchange* endgame (Act III) now has working state-scale proofs that institutions-push-to-wallet functions.

---

## Part VIII — The final question

> **"If AutoBureau failed in five years, what would most likely have caused it?"**

Ranked honestly, with the corpus as evidence:

**1. (≈50%) Quiet entropy — the Manilla-Mint death.** Not a competitor. Not a breach. The ledger never got true and fresh cheaply enough; users onboarded at a pain spike, coverage stalled at 40%, the digest went stale, week-8 forwarding decayed, CAC never paid back — and in year three the company was alive, respectable, and unfundable, then sold for parts. Every ancestor in Part I §1 died exactly this way, and we are not exempt by being smarter — only by *measuring earlier*: this is what G1–G3's kill thresholds exist to catch in month 2 instead of year 3. **The most dangerous week is the one where we ship features instead of moving coverage/freshness.**

**2. (≈20%) Rocket Money ships "Deadlines & Documents" before our wedge compounds.** They have the users, the ingestion, and the found-money brand. If we're still horizontal-curious and tenure-shallow when they move, we lose on distribution. Counter already in motion: caregiver depth they won't build, non-transactional standing they can't see, and speed.

**3. (≈12%) Self-inflicted scope relapse.** The pattern this whole project has fought: building the OS instead of the wedge, the chat instead of the ledger, the agent instead of the reminder that arrives on time. The governance (PRD §21, gates) exists precisely because this failure mode is *ours*, not the market's.

**4. (≈8%) Trust rupture** — a breach, or one viral "AutoBureau told me wrong and I missed my registration." Architecture and X-metrics guard it; the probability is low *because* we've spent so heavily against it; the severity is company-ending, which is why the spend stays.

**5. (≈10%) The remainder:** stateless-agent paradigm shift arriving faster than the ledger compounds; inbox-access rug-pull; founder/capital exhaustion in the slow-compounding middle (years 2–3, the "boring valley" where systems of record are built and investors get bored).

**The one-sentence verdict:** *if AutoBureau dies, it will almost certainly die the way every one of its ancestors died — not murdered by a giant, but starved by its own ingestion friction — and everything in the blueprint that measures coverage, freshness, and week-8 forwarding earlier than any predecessor measured anything is the entire difference between us and the graveyard.*

---

### Primary live sources
[Trustworthy funding (Crunchbase)](https://www.crunchbase.com/organization/trustworthy-7aca) · [Duckbill (Fast Company)](https://www.fastcompany.com/90952198/duckbill-blends-ai-and-human-intelligence-for-personal-assistant-service) · [Yohana closure (ChannelNews)](https://www.channelnews.com.au/panasonics-ai-ambitions-stumble-as-consumer-apps-hit-delays-and-closures/) · [Ohai.ai](https://www.ohai.ai/features/) · [Gemini/Gmail budget features (Google blog)](https://blog.google/innovation-and-ai/products/gemini-app/gemini-budget-planning-tips/) · [ChatGPT agent (OpenAI)](https://openai.com/index/introducing-chatgpt-agent/) · [GPT-5.6 work agents (Forbes)](https://www.forbes.com/sites/anishasircar/2026/07/10/openais-gpt-56-lands-with-work-agents-and-a-desktop-pivot/) · [Rocket Money pricing/features (CNBC)](https://www.cnbc.com/select/rocket-money-review/) · [CFPB 1033 status (Consumer Finance Monitor)](https://www.consumerfinancemonitor.com/2026/06/26/open-banking-regulation-in-2026-federal-regulation-resurfaces-as-states-bring-data-sharing-into-focus/) · [Direct File ended (Forbes)](https://www.forbes.com/sites/kellyphillipserb/2026/01/06/direct-file-is-gone-heres-how-you-can-still-file-your-taxes-for-free/) · [mDL tracker (Credence ID)](https://credenceid.com/resources/blog/us-mobile-drivers-license-mdl-state-tracker/) · [eIDAS 2.0 timeline (Gataca)](https://www.gataca.io/resources/blog/eIDAS2-timeline/) · [Cushion shutdown (TechCrunch)](https://techcrunch.com/2025/01/30/fintech-startup-cushion-shuts-down-after-8-years-and-over-20-million-in-funding) · [Marble → The Zebra](https://www.thezebra.com/about/press/the-zebra-acquires-marble-insurance-management-platform/) · [Milo (gomilo.app)](https://www.gomilo.app/) · [Carefull launch](https://www.wealthmanagement.com/financial-technology/protecting-a-loved-one-s-finances-there-s-an-app-for-that) · [YC AI-assistant directory](https://www.ycombinator.com/companies/industry/ai-assistant)
