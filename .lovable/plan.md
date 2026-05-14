
# Phase 0 — Driver Contract Intelligence: Spec & Implementation Map

Planning only. No code, no schema, no migrations, no UI changes. Reuses existing HaulTrackerPro patterns end-to-end.

---

## 1. Existing Architecture Review (what we'll build on)

| Area | Current pattern | Reuse for contracts |
|---|---|---|
| Auth | Supabase Auth via `useAuth.tsx`, AuthProvider | All contract calls require `auth.uid()` |
| RLS scoping | `auth.uid() = user_id`, `is_admin(_uid)`, `is_recruiter_owner(_uid, _recruiter_id)`, `is_super_admin(_uid)` | Same helpers; add `is_application_party(_uid, _application_id)` |
| Forward-only state | `opportunity_applications_update_guard` (rank-based) | Mirror for `contracts.status` transitions |
| Field-lock on update | `recruiter_billing_field_guard`, `prevent_profile_billing_field_updates` (service-role bypass) | Lock AI/system fields against user writes; allow service-role |
| Approval workflow | `recruiter_profile_guard` (rejected → pending self-resub) | Drives `changes_requested → uploaded` recruiter resubmission |
| Admin moderation | `admin_users` + `admin_audit_log` + AdminShell + AdminRecruitersPanel | New AdminContractsPanel; reuse audit log table or add `contract_audit_log` |
| Storage | Only `lead-magnets` bucket (public) | New PRIVATE bucket — never reuse public bucket |
| Edge functions | `verify_jwt = false` shell, `INTERNAL_FUNCTION_SECRET`, service-role client pattern (e.g. `ai-insight`, `stripe-webhook`) | Same shell for upload/parse/analyze functions |
| AI | Lovable AI Gateway (`LOVABLE_API_KEY`), structured Gemini extraction (per `architecture/ai-integration-strategy`) | Same gateway, structured JSON via tool-call schema |
| Pro gating | `useSubscription.isPro`, locked-preview cards (`ProInsightCard`, `OpportunityProfitBreakdown`) | Same pattern: free = summary; Pro = full clause list + downloads |
| Hooks/data | TanStack Query, `useOpportunityApplications` shape | New `useContracts(applicationId)`, `useContractReview(contractId)` |
| Design tokens | Dark navy + amber `text-primary`, semantic Tailwind tokens, Card/Badge primitives | Status badges, risk-tier badges, locked Pro cards |

No existing code needs to change to start Phase 1.

---

## 2. Database Design (proposed — not built)

Conventions: every row owned by `recruiter_id` and/or `driver_user_id`; system fields locked via trigger; admins bypass via `is_admin`; service-role bypass for AI writes.

### `contracts`
Logical document tied to one application (or to a driver-uploaded personal contract).

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| application_id | uuid NULL | FK-style ref to `opportunity_applications.id` (recruiter-uploaded path) |
| opportunity_id | uuid NULL | denormalized for fast lookup |
| recruiter_id | uuid NULL | denormalized; NULL for driver-uploaded |
| driver_user_id | uuid NOT NULL | the driver who reviews |
| uploader_user_id | uuid NOT NULL | recruiter user OR driver user |
| upload_source | enum: `recruiter`, `driver_self`, `admin` | gates which RLS branch applies |
| contract_kind | enum: `lease_purchase`, `owner_operator`, `dispatch`, `escrow`, `independent_contractor`, `company_onboarding`, `other` | drives prompt template |
| current_version_id | uuid NULL | latest version pointer |
| status | enum (see §3) | forward-only via trigger |
| risk_score | int 0–100 NULL | written by service role |
| risk_tier | enum: `low`,`medium`,`high`,`severe` NULL | derived |
| driver_decision | enum: `pending`,`approved`,`changes_requested`,`rejected` NULL | |
| driver_decision_at | timestamptz NULL | |
| created_at, updated_at | timestamptz | |

Indexes: `(driver_user_id, status)`, `(recruiter_id, status)`, `(application_id)`, `(status, risk_tier)` for admin queue.

### `contract_versions`
Immutable file revisions. Replacing = new row, never UPDATE.

| Column | Notes |
|---|---|
| id, contract_id | PK / FK |
| version_number | int, monotonic per contract |
| storage_path | `contracts/{recruiter_id|driver_user_id}/{contract_id}/v{n}/{filename}` |
| mime_type | enforce in trigger (PDF / DOCX / PNG / JPG) |
| byte_size | int |
| sha256 | unique per contract — dedupes accidental re-upload |
| page_count | NULL until parsed |
| extracted_text | text NULL — written by service role only |
| parse_status | enum: `pending`,`parsing`,`parsed`,`parse_failed` |
| uploaded_by | uuid |
| created_at | |

Indexes: `(contract_id, version_number DESC)`, `(parse_status)`.

### `contract_clauses`
AI-extracted findings. Service-role insert only.

| Column | Notes |
|---|---|
| id, contract_id, version_id | |
| category | enum (escrow, deductions, forced_dispatch, termination, maintenance, liability, chargebacks, payment_timing, non_compete, insurance, discretion, lease_risk, pay_withholding, refund, other) |
| severity | enum: `info`,`low`,`medium`,`high`,`severe` |
| title | short label |
| quote | original clause text excerpt |
| plain_english | driver-facing explanation |
| recommendation | suggested action |
| page_ref, char_offset | locator |
| confidence | numeric 0–1 |
| created_at | |

Indexes: `(contract_id, severity DESC)`.

### `contract_reviews`
Threaded reviews (driver, admin, AI summary record).

| Column | Notes |
|---|---|
| id, contract_id, version_id | |
| reviewer_role | enum: `driver`,`admin`,`ai_system` |
| reviewer_user_id | NULL for ai_system |
| verdict | enum: `summary`,`approve`,`changes_requested`,`reject`,`note` |
| body | text (driver-readable) |
| ai_payload | jsonb NULL (raw model output for ai_system rows only) |
| created_at | |

Indexes: `(contract_id, created_at DESC)`.

### `contract_audit_log`
Append-only. Every view, download, status change, AI run.

| Column | Notes |
|---|---|
| id, contract_id | |
| actor_user_id | nullable (service-role events) |
| actor_role | `driver|recruiter|admin|service` |
| action | `upload|view|download|parse|ai_review|status_change|decision|delete` |
| metadata | jsonb (old/new status, ip, ua, version_id) |
| created_at | |

Indexes: `(contract_id, created_at DESC)`, `(actor_user_id)`.

### `contract_signatures` (Phase 7 only — schema reserved, not built in MVP)
Holds typed/drawn or provider-webhook signatures with hash + ip + ua.

### Triggers required
- `contracts_status_guard` — forward-only rank, service-role bypass.
- `contracts_field_lock` — clients cannot write `risk_score`, `risk_tier`, `current_version_id`, `application_id` on update.
- `contract_versions_immutable` — block UPDATE/DELETE for non-admin/non-service.
- `contract_clauses_service_only` — INSERT/UPDATE only by service role or admin.
- `contract_audit_log_append_only` — block UPDATE/DELETE entirely.
- `set_contract_audit_on_status_change` — auto-log status transitions.
- New helper SECURITY DEFINER fn `is_application_party(_uid uuid, _application_id uuid)` returning true if `_uid = driver_user_id` OR owns the recruiter side.

### RLS summary
- `contracts` SELECT: driver where `driver_user_id = auth.uid()`; recruiter via `is_recruiter_owner(auth.uid(), recruiter_id)`; admin via `is_admin`. INSERT: recruiter for own application OR driver for `upload_source='driver_self'`. UPDATE: limited to user-mutable fields; system fields locked by trigger.
- `contract_versions` SELECT: same as parent contract. INSERT: uploader matches contract upload_source rule. No UPDATE/DELETE for non-admin.
- `contract_clauses` SELECT: same as parent contract. No client INSERT/UPDATE/DELETE.
- `contract_reviews` SELECT: parties to the contract. INSERT: driver may add `verdict in (approve, changes_requested, reject, note)`; admin any; service-role only writes `summary`.
- `contract_audit_log` SELECT: admin all; recruiter/driver only own actions on contracts they're party to. INSERT: any party for self-actions (view/download); status_change/parse/ai_review only by service.

---

## 3. Lifecycle

Full lifecycle (target):

```text
draft → uploaded → parsing → parsed → ai_reviewed
       → driver_reviewing → (changes_requested → uploaded) | rejected | approved
       → signed (Phase 7) → archived | expired
```

**MVP simplification (Phases 1–5):**

```text
uploaded → parsing → parsed → ai_reviewed → driver_reviewing
        → changes_requested | rejected | approved
        → archived
```

Drop `draft`, `signed`, `expired` until Phase 7. Status is forward-only except `changes_requested → uploaded` (recruiter resubmission), which mirrors the existing `recruiter_profile_guard` rejected→pending pattern.

---

## 4. Roles & Access

| Action | Driver | Recruiter | Admin | Service |
|---|:-:|:-:|:-:|:-:|
| Upload contract for own application | — | ✅ | ✅ | — |
| Upload personal/own contract for review | ✅ (Phase 5) | — | ✅ | — |
| View contract attached to own application | ✅ | ✅ (own opp) | ✅ | ✅ |
| Download original PDF | ✅ via signed URL | ✅ via signed URL | ✅ | ✅ |
| View AI risk summary | ✅ free tier | ✅ | ✅ | ✅ |
| View full clause list | Pro only | ✅ | ✅ | ✅ |
| Replace with new version | — | ✅ | ✅ | — |
| Approve / request changes / reject | ✅ | — | ✅ override | — |
| Edit AI findings | ❌ | ❌ | ✅ correction note only | ✅ |
| See audit trail | own actions | own actions | full | full |
| Suspend recruiter on abuse | — | — | ✅ | — |

Anonymous users: zero access.

---

## 5. Storage Strategy

- **Bucket:** `contracts` — **private** (`public = false`). Never reuse `lead-magnets`.
- **Key layout:**
  - Recruiter-uploaded: `recruiter/{recruiter_id}/{contract_id}/v{n}/{uuid}_{safe_filename}`
  - Driver-uploaded: `driver/{driver_user_id}/{contract_id}/v{n}/{uuid}_{safe_filename}`
- **Storage RLS** scoped by first folder segment matching `auth.uid()` for writes; reads always go through edge function `contract-signed-url` (no direct storage SELECT for clients) so we can audit-log every access and verify party membership.
- **Limits:** ≤ 25 MB/file, ≤ 100 pages, ≤ 5 versions per contract initially.
- **MIME allowlist:** `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `image/png`, `image/jpeg`. Magic-byte sniffed server-side, not just header.
- **Signed URL TTL:** 5 minutes, single-use intent; logged in `contract_audit_log` with `action='view'|'download'`.
- **Downloads:** allowed for parties (driver always gets the document they were asked to sign — non-negotiable for trust). Watermark overlay deferred to a later phase.
- **PII:** treat all contract text as sensitive; never log extracted text in console; redact in error messages.

---

## 6. AI Review Scope

**Pipeline (3 edge functions):**
1. `contract-upload` — issues signed write URL, validates MIME/size, creates `contract_versions` row in `parse_status='pending'`.
2. `contract-parse` — pulls file, extracts text (PDF text layer first, OCR fallback for scanned/image), writes `extracted_text` + `page_count`, transitions to `parsed`.
3. `contract-analyze` — sends extracted text to Lovable AI Gateway (Gemini structured tool-call) with category list below; persists `contract_clauses` rows + writes `risk_score`, `risk_tier`, `summary` review row; transitions to `ai_reviewed`.

**Categories analyzed:** escrow, deductions (insurance/maintenance/admin), forced dispatch, termination penalties, maintenance responsibility, equipment liability, chargebacks, payment timing & withholding, non-compete / non-solicit, insurance responsibility, "company sole discretion" language, lease-purchase risk, refund conditions, dispatch fees.

**AI output schema (tool-call params):**
```json
{
  "overall_risk_score": 0,
  "overall_risk_tier": "low|medium|high|severe",
  "summary_plain_english": "string",
  "driver_actions": ["string"],
  "clauses": [
    {
      "category": "escrow",
      "severity": "info|low|medium|high|severe",
      "title": "string",
      "quote": "string",
      "plain_english": "string",
      "recommendation": "string",
      "page_ref": 1,
      "confidence": 0.0
    }
  ]
}
```

**Mandatory disclaimer** rendered with every AI summary: *"This is not legal advice. Review with a qualified attorney before signing."* Stored in `contract_reviews.body` for audit.

**Tier mapping:** `severe ≥ 80`, `high 60–79`, `medium 35–59`, `low < 35`.

**Caching:** key on `version_id` + prompt-version; never re-bill on identical re-views.

---

## 7. MVP UI Surfaces

Minimal first surface — additive only, zero changes to existing screens beyond a single new card slot:

1. **Recruiter — `RecruiterApplicationsDashboard` row action:** "Attach contract" → upload modal (drag/drop, kind selector). Shows current version + status badge.
2. **Driver — `DriverApplicationsPanel` row:** "Contract Review" CTA appears only when `contracts.status >= 'ai_reviewed'`.
3. **Contract Detail (modal or `/dashboard?page=contracts&id=…`):**
   - Header: kind, status badge, risk-tier badge, version selector
   - AI Summary Card (always visible)
   - Red Flags list (free shows top 3 + locked count, Pro shows all)
   - Original document viewer + Download (signed URL)
   - Driver actions: Approve / Request Changes / Reject (with note)
   - History timeline (from `contract_reviews` + `contract_audit_log`)
4. **Admin — `AdminContractsPanel`** under existing AdminShell sidebar: queue filtered by `risk_tier in ('high','severe')` or driver-rejected; same review surface + admin notes.

No changes to: Loads, Reports, Parking, Pricing copy, Stripe flows, Recruiter Billing, Opportunities listing, public marketing pages.

---

## 8. Phased Build Plan (post-Phase-0)

| Phase | Scope | Ship gate |
|---|---|---|
| **1** | Schema + private bucket + RLS + audit log table + helper fns. No UI. | Lints clean, RLS unit checks pass. |
| **2** | `contract-upload` edge fn + recruiter upload UI + driver read-only viewer (no AI). | Recruiter can upload, driver can view, admin sees in queue. |
| **3** | `contract-parse` edge fn (text + OCR fallback). | `parsed` status reached for sample PDFs and scans. |
| **4** | `contract-analyze` (Lovable AI structured), risk score, clauses, summary card UI, Pro-gated full clause list. | AI summary shown; Pro upsell triggers correctly. |
| **5** | Driver decision flow (approve / request changes / reject) + recruiter resubmission cycle + driver-uploaded personal contracts. | Forward-only state guard verified. |
| **6** | Admin moderation queue, override actions, abuse-flag → recruiter suspension hook. | Admin can resolve high/severe queue. |
| **7** | Optional: in-app simple signature OR DocuSign/Dropbox-Sign integration; gate `opportunity_applications.status='hired'` on signed contract. | Behind feature flag; no impact if disabled. |

Each phase is independently shippable and behind the assumption that prior phases passed QA.

---

## 9. Risk Assessment

| Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|
| **Legal — UPL / "legal advice"** | Med | High | Mandatory disclaimer, "informational only" copy, no recommendations to specific clauses without "consult an attorney" line, audit-logged. |
| **Privacy / PII leak** | Med | Severe | Private bucket, 5-min signed URLs, no public CDN, no logging extracted text, error redaction, full audit trail. |
| **RLS bypass** | Low | Severe | All access via security-definer helper `is_application_party`; storage reads gated through edge fn; trigger-locked system columns; service-role bypass explicit and tested. |
| **Storage leak (wrong folder)** | Low | High | Server-derived storage path (never client-supplied), magic-byte MIME check, `sha256` dedupe. |
| **AI hallucination — false red flag or missed clause** | High | Med | Always include original quote + page_ref so driver verifies; show confidence score; disclaimer; admin can append correction note (cannot edit AI row). |
| **Recruiter abuse (uploading misleading docs, spam, malware)** | Med | High | MIME + size limits, file scan hook reserved, plan-limit on uploads/week, abuse-report → admin queue, suspension via existing `recruiter_profiles.status='suspended'`. |
| **Driver misunderstanding** | Med | Med | Plain-English layer mandatory, severity tiers color-coded, top action recommendations capped at 3, persistent disclaimer. |
| **Billing / Pro gating regression** | Low | Med | Reuse `useSubscription` + `OpportunityProfitBreakdown` pattern; never gate the *summary* (trust); only gate full clause list, downloads of detailed report, multi-version diff. |
| **Cost overrun (AI tokens)** | Med | Med | Cache by `version_id`, debounce reanalysis, cap pages at 100, free-tier daily limit. |
| **Scope creep into e-sign** | High | Med | Explicit "Phase 7 only" boundary; MVP stops at decision record. |

---

## 10. Final Recommendation

**Proceed.** The product gap is real (drivers sign predatory lease/dispatch agreements blind), the existing infra (Lovable AI, RLS helpers, admin moderation, opportunity_applications, Pro gating) covers ~70% of what's needed, and risk is manageable with the storage + disclaimer + RLS rules above.

**Safest MVP scope (Phases 1–4 only for first release):**
- Recruiter uploads → driver views with AI risk summary + top clauses + download.
- Driver decision flow (Phase 5) ships in the very next iteration.
- Admin queue (Phase 6) lights up once first abuse signals appear.
- E-signature (Phase 7) deferred indefinitely unless drivers explicitly ask.

**Free vs Pro split:**

| Capability | Free | Pro |
|---|:-:|:-:|
| Receive contract from approved recruiter | ✅ | ✅ |
| AI risk score + tier badge | ✅ | ✅ |
| Plain-English summary | ✅ | ✅ |
| Top 3 red flags | ✅ | ✅ |
| Full clause-by-clause findings | locked preview | ✅ |
| Download original PDF | ✅ (always — trust requirement) | ✅ |
| Download AI report (PDF) | — | ✅ |
| Compare versions side-by-side | — | ✅ |
| Personal contract upload (driver-self) | 1 per month | unlimited |
| Recruiter contract upload | per plan limit | per plan limit |

**Defer to a later release:** in-app e-signature, multi-party signing, attorney marketplace referrals, watermarking, redaction tools, cross-contract pattern detection across drivers.

**No existing feature touched.** Loads, expenses, fuel, parking, reports, pricing, Stripe, recruiter billing, admin moderation, auth, sitemap, and SEO routes remain unchanged through Phase 6.
