# Brief: rebuild brochure discovery ("Find brochure")

> **STATUS — BUILT 18 Sept 2026, and the design below was changed on the way.** Read `status-2026-09-18.md` §2–§4
> first. What changed: §5's "rep picks from a candidate list" was **dropped** (Matt: the rep must not pick) — the
> finder verifies the document itself and attaches nothing when unsure; official **web brochures** are accepted as
> well as PDFs; outcomes are six statuses with a separate `documentType`; "not found" carries a trace; the
> promotions register is **not** changed for brochures (§5 step 6 and §6 "Register" do not apply); §3's "UNCOMMITTED"
> note is stale (those changes were committed in `70aadd6` / `5f40928`, and the allowlist has since been deleted).
> §2 (the problem), §4 (the thinking gaps) and §7 (constraints) still stand. §9's open questions are closed: brochures
> outrank price/spec guides; a found or uploaded brochure is shared by every rep for 90 days; the junk-host list is in
> `finder.ts`.
>
> **UPDATE 21 Sept 2026 — the UK-only rule was loosened (Matt).** The UK edition is still the target, but when none
> verifies the finder now falls back to the manufacturer's own **European brochure in English** (`market: 'eu'`).
> §4's "Non-UK leakage" concern is handled by marking, not refusing: the record is titled "European edition" and the
> rep is told. Rules and live evidence (Polestar 2): `status-2026-09-21.md` §2–§4.

**For:** Fable (implementing agent) · **Author:** Claude Code with Matt Wilson · **Date:** 15 Sept 2026
**Repo:** `email-offer-builder` (DreamLease Offer Mailer). Read `CLAUDE.md` and `docs/dreamlease-offer-mailer-brief.md` §5.8 first.

---

## 1. Objective

A rep assembling an offer email can attach the vehicle's **manufacturer brochure** (a PDF) to an offer. The brochure is downloaded, stored on our own R2 (CAP‑ID‑free), and served to recipients from `/b/:id`. Because this is an FCA‑regulated financial promotion, the attached document must be the **genuine manufacturer brochure for that vehicle**, not a dealer/aggregator/other‑market document.

The current implementation does not reliably achieve this. This brief replaces the discovery mechanism.

## 2. The problem

Discovery is gated on a **hand‑maintained static allowlist** of manufacturer UK domains (`config/manufacturer-uk-domains.json`, ~38 entries). The harvest runs a Firecrawl search, keeps only results whose host is on the allowlist, prefers a `.pdf`, downloads and stores it; if nothing allowlisted is found it falls back to a "gated" link, then fails.

**This approach is structurally broken:**

- OEMs increasingly serve UK brochures from **global domains**, not `<brand>.co.uk`: Kia is `kia.com/content/dam/kwcms/kme/uk/en/…`, Denza is `denza.com/uk` (with PDFs likely under `/material/denzauk/…`), Volvo `volvocars.com/uk`, Tesla `tesla.com/en_gb`.
- Path structures are **idiosyncratic and unpredictable** (a clean `/uk/` segment for some, `denzauk` country tags for others, deep CDN paths for others).
- Domains **move** (Kia left `kia.co.uk`; GWM's Ora is now `gwmcars.co.uk`; XPENG is `xpengcars.co.uk`; Leapmotor is `leapmotor.net/uk`).
- **New brands arrive constantly** (Chinese EV brands especially), each needing manual research and a new entry.

The list is therefore **wrong the moment it is written and needs perpetual manual curation.** When an entry is stale the failure is **silent and customer‑facing**: the harvest gates to a wrong/dead link and the email shows "Request a brochure" pointing at a 404. That is the bug Matt hit with Kia (gated to a dead `kia.co.uk/request-a-brochure.aspx`).

## 3. What has been done so far (this session — build on it, don't redo it)

These changes are **applied locally and verified but UNCOMMITTED** at time of writing. Treat them as the current baseline.

1. **Firecrawl `rawBase64` download** (`packages/adapters/src/firecrawl/client.ts` → `fetchFile(url)`): manufacturer CDNs (Akamai) return `403` to the Worker's direct `fetch`, but Firecrawl's proxies fetch the file and `rawBase64` returns the original bytes. The harvest now falls back to `fetchFile` when the direct download comes back empty. **This is the key enabler and must be kept** — it means we can fetch a brochure from *any* source, so the trust decision no longer needs to be "only download from hosts we pre‑trust".
2. **`http`→`https` normalisation** in `harvest.record()`: a Firecrawl result can be `http://`; the `Brochure.sourceUrl` schema is https‑only, so an unnormalised http URL threw on load and 500'd every campaign that used it. Now upgraded at record time.
3. **Allowlist matcher** (`packages/adapters/src/brochure/allowlist.ts`) taught to recognise UK content on a global domain via a `/uk|/gb|/en-gb` **path segment** (not just a leading prefix). *This is a partial patch of the doomed approach — see gaps.*
4. **Corrected 6 stale entries** + brand aliases: Kia→`kia.com`, Omoda→`omodaauto.co.uk`, Jaecoo→`jaecoo.co.uk`, Ora→`gwmcars.co.uk`, XPENG→`xpengcars.co.uk`, Leapmotor→`leapmotor.net/uk`.
5. **Audit script** (`scripts/audit-allowlist.mjs`): Firecrawl‑checks every brand and flags stale entries. Proved 6+ entries wrong. (Interim tool; delete when the allowlist gate is gone.)

Verified: 52 adapter tests pass; Kia EV2 now harvests a real PDF (`kia.com/.../uk/en/…ev2-specifications.pdf`, 937 KB) served from `/b/:id`.

## 4. Gaps / shortfalls in thinking (own these; the redesign exists because of them)

- **Defended the static allowlist as a "compliance control".** It is not a control — it is an unmaintainable liability. The trust question ("is this the real manufacturer brochure?") cannot be answered by a hand‑typed domain list.
- **Put the trust decision in the wrong place — the machine.** The harvest autonomously decides which PDF is trustworthy and attaches it silently. The right decision‑maker is the **rep**, who knows the exact vehicle and can recognise its brochure. This tool's whole ethos is "a human presses send" (drafts only); brochure selection should be the same.
- **Even the improved matcher still fails** on non‑`/uk/` country markers (`denzauk`, deep CDN paths). Patching path rules per brand is the same losing game.
- **Silent failure reaches customers.** When discovery is wrong there is no signal to the rep — a dead/wrong brochure link ships. Any redesign must make "no confident result" visible and force a human choice.
- **No ranking / selection.** The harvest grabs the first allowlisted PDF (it took Kia's *specifications* sheet, not the fuller *brochure*). There is no notion of "best" candidate.
- **Non‑UK leakage** (euro‑priced / other‑market brochures) is only softly mitigated by a `£`/`€` content peek.

## 5. Target design — "the machine finds, the rep confirms"

Replace the allowlist **gate** with a **candidate‑and‑confirm** flow:

1. Rep clicks **Find brochure** on an offer.
2. Server runs Firecrawl search(es) for `<make> <model> brochure pdf` (+ a spec/price‑guide variant), UK‑located.
3. Server **ranks candidates** and returns the top 3–5, each with: source domain, page/PDF title, file type (PDF vs a request/landing page), size if known, and a UK/– confidence signal. It **excludes obvious junk** via a small stable **denylist** (aggregators & review & dealer sites: `scribd`, `carwow`, `autocatalogarchive`, `auto-brochures`, `motaclarity`, dealer CDNs, `pentagon-group`, `yumpu`, `issuu`, `slideshare`, etc.).
4. Rep **picks one** (or picks none → manual upload/paste, which already exists).
5. Server downloads the chosen file via **`rawBase64`** (works past bot protection), verifies it is a PDF (`%PDF` magic, ≤ 40 MB), stores it under `brochures/<sha256>.pdf` in R2, and records a `Brochure` with `source: 'rep_selected'` (add to the enum) and `ukVerified.by: 'user'`.
6. The chosen **source URL and the rep** are recorded in the promotions register (the compliance trail).

**Why this is better *and* more compliant:** a human who knows the car confirms the exact document; the register records who chose what and from where. That is a stronger, auditable control than a domain list — and it needs **zero per‑brand maintenance**. Kia on kia.com, Denza on denza.com/uk, next month's brand on whatever: irrelevant.

### Keep
- `rawBase64` download + R2 hosting + `/b/:id` serving.
- Manual upload / paste‑link fallback (`POST /api/brochures/manual`) — the always‑works path.
- The 24h/90‑day cache and "one current brochure per `vehicleKey`, shared across offers/reps" model (`ensureBrochure`), but keyed off the rep‑selected result.
- The `Brochure` schema, `assertNoCapId`, three‑layer separation.

### Remove / demote
- The **static allowlist as a hard gate** (`config/manufacturer-uk-domains.json` + `isAllowlisted` filtering in `harvest.ts`). At most keep a small **denylist** of junk hosts to clean the candidate list. Delete the allowlist audit script and the per‑brand aliases once the gate is gone.
- The silent autonomous "gate to a manufacturer page" fallback — replaced by the rep either picking a candidate or using manual.

## 6. Concrete work items

- **`packages/adapters/src/brochure/`**: new `findCandidates(vehicle, deps)` → ranked `BrochureCandidate[]` (`{ url, host, title, kind: 'pdf'|'page', ukSignal, sizeBytes? }`). Junk denylist. Keep `fetchFile`/download/store. `ensure` becomes: return cached current copy, else return candidates for the rep to choose (no autonomous attach).
- **`packages/schema`**: add `BrochureCandidate`; add `'rep_selected'` to `Brochure.source`.
- **`apps/api/src/brochures.ts`**: `POST /api/brochures/candidates {make,model}` → candidate list (Firecrawl). `POST /api/brochures/select {make,model,url}` → download+store+return the `Brochure`. Keep `/manual`, `/current`, `/b/:id`. Remove the allowlist import/gate.
- **`apps/web/src/Compose.tsx` (`BrochureControl`)**: "Find brochure" → show candidate cards (source, title, PDF badge, UK signal) → rep picks → attaches; "None of these / upload" → existing manual UI. Show a spinner/progress during the ~10–20s search+fetch (Matt also asked for a progress indicator).
- **Register**: include the brochure's chosen `sourceUrl` + selector in the promotions register row.

## 7. Constraints (non‑negotiable — from `CLAUDE.md`)

1. **CAP IDs never stored.** Only our R2 URL is persisted; never a source image URL. `assertNoCapId` guards every persisted object.
2. **Three layers, no leaks.** Adapters don't import each other; `render()` is the only HTML producer; React never builds email HTML.
3. **Compliance locked.** Rep‑authored copy + the chosen brochure source are recorded verbatim in the register; drafts only.
4. **Drafts only.** The Worker never sends.
5. **Firecrawl is the one metered service** — cap credits per find (search ≈ 2, rawBase64 fetch ≈ 2); cache results 24h+ per `vehicleKey`. Cloudflare only (Workers, D1, R2, Images); nothing CPU‑heavy in the request path.

## 8. Acceptance criteria

With **no per‑brand domain configuration**:
- **Kia EV2** (global domain, bot‑protected): Find brochure returns the `kia.com/.../uk/…` PDF among candidates; rep picks it; it downloads, hosts, serves from `/b/:id`, and renders "Download brochure (PDF)".
- **BMW / Vauxhall** (legacy `.co.uk`): still resolve to the right PDF.
- **Denza** (pre‑launch, no UK PDF yet): returns candidates or a clean "no confident brochure found — upload/paste" with **no dead link ever shipped**.
- **Aggregator junk** (scribd/carwow/dealer): never appears as a candidate.
- Manual upload/paste still works as the fallback.
- Adapter + API tests cover: candidate ranking, denylist exclusion, `rawBase64` download of a blocked host, and the "none found → manual" path.

## 9. Open questions for Matt

- Candidate ranking: prefer a PDF whose URL/title contains "brochure" over "spec/price guide"? Show both?
- Should a rep‑selected brochure be reusable by other reps for the same model automatically (cache), or is selection per‑campaign?
- Denylist: confirm the initial junk‑host list.
