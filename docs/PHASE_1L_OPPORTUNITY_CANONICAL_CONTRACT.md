# Phase 1L Opportunity Canonical Contract

## Status

- **Status:** Normative architecture contract
- **Phase:** 1L-B
- **Scope:** recruiter-created opportunities only
- **Implementation status:** specification only; no runtime behavior changed
- **Source baseline:** commit `368139e15d4a97b240c35dffe0f971afae82ae3c`
- **Amendment rule:** Later phases must not contradict this contract without a separately approved contract amendment.

---

## 1. Purpose and Non-Goals

Binding principles for all later Phase 1L work:

1. A stored `opportunities` row is **source data**, not a driver-facing view model.
2. **One canonical normalizer** must sit between storage and every recruiter preview, publication validator, financial calculator, match calculator, list card, and detail page.
3. Recruiter preview and driver rendering must consume the **same `CanonicalOpportunity` object** produced by that normalizer.
4. **Publication approval**, **recruiter verification**, **marketing placement** (Featured), and **financial quality** are strictly separate concepts. None implies any of the others.
5. This phase does **not** choose a SQL migration shape, implement UI, change production data, or modify publication triggers. It defines the contract that later phases must satisfy.

Non-goals for 1L-B: no code, no schema, no data repair, no UI, no tests, no dependency changes.

---

## 2. Required Architecture Layers

Canonical data flow, in strict order:

```
OpportunitySourceRow
    -> normalizeOpportunity
        -> CanonicalOpportunity
            -> validatePublicationReadiness
            -> calculateOpportunityFinancials
            -> calculateOpportunityMatch
                -> RecruiterPreview  and  DriverOpportunityView
```

Invariants:

- **No UI component may calculate directly from raw database values.** All UI reads from `CanonicalOpportunity` or its derived objects.
- **No UI component may infer field relevance from truthiness.** Relevance is a property of the canonical classification, not of the presence of a value.
- **No recruiter and driver surface may use separate formulas.** Both call the same normalizer and the same calculators.
- **No publication validator may use weaker rules than the canonical contract.** Server-side validation must be at least as strict as this document.
- **Derived estimates are never persisted as verified facts merely because a recruiter entered them.** Recruiter-provided values remain labeled recruiter-provided.

---

## 3. Canonical Classification

Two independent classification dimensions replace the current single `driver_type` string.

### Employment model

- `company_driver`
- `contractor_1099`
- `owner_operator`
- `lease_purchase`
- `unknown`

### Team configuration

- `solo`
- `team`
- `solo_or_team`
- `unspecified`

### Legacy `driver_type` normalization

| Legacy value | `employmentModel` | `teamConfiguration` |
|---|---|---|
| `company`, `company_driver` | `company_driver` | `unspecified` |
| `1099`, `1099_contractor`, `contractor_1099` | `contractor_1099` | `unspecified` |
| `owner_operator` | `owner_operator` | `unspecified` |
| `lease_purchase` | `lease_purchase` | `unspecified` |
| `team`, `team_driver` | `unknown` | `team` |
| any unrecognized value | `unknown` | `unspecified` |

**Team-row rule:** Do not guess an employment model for a legacy Team Driver row. A new publication or republication of such a row is blocked until the recruiter resolves the employment model.

### Pay model

Canonical values:

- `cpm`
- `percentage`
- `flat_weekly`
- `salary`
- `mixed`
- `other`
- `unknown`

Unrecognized pay values normalize to `unknown` and **cannot be newly published**.

---

## 4. Explicit Disclosure Semantics

All optional fact-bearing fields expose a canonical `Disclosure<T>` with exactly three states:

- `provided` — a valid value of type `T` exists
- `not_disclosed` — the field is relevant to this classification but the recruiter explicitly did not provide it
- `not_applicable` — the field does not apply to this opportunity classification

Rules:

- `null` or blank never automatically means zero.
- Zero is an explicit numeric value and remains zero.
- `false` is an explicit boolean value and remains `false`.
- `not_disclosed` and `not_applicable` must never render as the same thing.
- A relevant `provided` value of zero may be invalid under publication rules, but it must not be silently converted to `null`.
- The driver UI may display **"Not disclosed"** only for relevant optional fields in `not_disclosed` state.
- Irrelevant fields and irrelevant sections are **omitted**, not shown as dashes.

---

## 5. Canonical Opportunity Groups

`CanonicalOpportunity` groups (no other invented business domains):

- **identity:** `id`, `recruiterId`, `title`, `companyName`
- **classification:** `employmentModel`, `teamConfiguration`, `routeType`, `trailerType`
- **hiringArea:** `city`, `state`, `states`, `displayLabel`
- **compensation:** `payModel`, `recurringPay`, `oneTimeIncentives`, `mileage`, `accessorialPay`
- **operatingTerms:** `homeTime`, `forcedDispatch`, `petsAllowed`, `ridersAllowed`, `equipment`
- **costs:** `fuelPaidBy`, `insurance`, `escrow`, `lease`, `maintenance`, `other`
- **content:** `description`, `typicalLanes`, `requirements`, `actualBenefits`
- **trust:** `lifecycleStatus`, `internalReviewStatus`, `publishedAt`, `featured`, `recruiterVerification`
- **derived:** `publicationReadiness`, `financialEstimate`, `transparencyScore`, `matchResult`

`actualBenefits` is a **distinct concept** from `typicalLanes` and `requirements`. The legacy `benefits` column is **not** canonical; it is a legacy container that the normalizer splits.

---

## 6. Field Relevance Matrix

### Universal — every resolved employment model

`title`, `companyName`, `routeType`, `trailerType`, `hiringArea`, `description`, `homeTime`, `equipment`, `typicalLanes`, `requirements`, `actualBenefits`, `oneTimeIncentives`, and any accessorial pay that applies.

### `company_driver`

- Show: recurring compensation, mileage, accessorial pay, schedule/home time, equipment, actual benefits, qualifications.
- Do not show: lease, escrow, maintenance, insurance-deduction, or generic other-deduction cards from the current schema.
- Do not calculate recruiter-provided take-home / net pay from the current deduction columns.

### `contractor_1099`

- Show: recurring compensation, mileage, fuel responsibility, insurance, maintenance, other recurring costs, escrow when disclosed.
- Do not show: lease payment (unless `employmentModel = lease_purchase`).

### `owner_operator`

- Show: recurring compensation, mileage, fuel responsibility, insurance, maintenance, other recurring costs, escrow when disclosed.
- Do not show: lease payment (unless `employmentModel = lease_purchase`).

### `lease_purchase`

- Show: all owner-operator cost categories plus lease payment and lease-related risk disclosures.

### Legacy team row with `employmentModel = unknown`

- Existing visible rows may show only universal fields.
- Ownership-specific cost sections and net calculations are unavailable.
- New publication or republication is blocked until employment model is resolved.

---

## 7. Publication Readiness Contract

**Save Draft** and **Publish** are distinct actions with distinct requirements.

### Save Draft

Requires only:

- `title`
- `companyName`

### Publish — universal requirements

- `title`
- `companyName`
- Resolved `employmentModel` (not `unknown`)
- `teamConfiguration` at least `solo`, `team`, or `solo_or_team`
- Recognized `routeType`
- Recognized `trailerType`
- Non-empty hiring area
- Non-empty description
- Non-empty home-time statement
- Recognized `payModel`
- Pay-model-specific required facts (below)
- Explicit accuracy / transparency confirmation

### Pay-model rules

**CPM:**

- CPM > 0
- Estimated weekly miles > 0
- An explicitly provided loaded-mile value of `0` is invalid
- `deadhead_paid` must be explicitly `true` or `false` for publication
- Estimated weekly gross may be recruiter-provided, but must be labeled as recruiter-provided unless deterministically derived from complete operands

**Percentage:**

- Percentage > 0
- Percentage basis must be explicitly defined
- Enough recurring revenue information must exist to support a weekly gross range; otherwise `financialEstimate.status = incomplete` and publication is blocked

**Flat weekly:**

- Weekly amount > 0

**Salary:**

- Amount and pay period both defined
- A weekly normalized amount must be deterministically derivable

**Mixed:**

- At least two named recurring compensation components must be complete
- A generic unstructured "mixed" value is insufficient

**Other:**

- A named compensation method
- A supported weekly gross range

### Cost-bearing publication rules — `contractor_1099`, `owner_operator`, `lease_purchase`

- Every material recurring cost must have an **amount and frequency**, or an explicit `None` or `Not disclosed` state.
- `lease_purchase` additionally requires complete lease amount and frequency.
- If any material recurring cost is `Not disclosed`, the listing may publish only with `financialEstimate.status = incomplete` and **no estimated net or net RPM**.
- A missing frequency means the amount **cannot be normalized** or subtracted.

### `company_driver` publication rule

- Current lease/escrow/maintenance/insurance/other-deduction columns are **not accepted** as a basis for estimated net.
- Driver-facing take-home/net is **unavailable** unless a later approved contract introduces a legally and semantically valid company-driver take-home model.

### Conflict rule

- If a recruiter-provided weekly gross and a deterministic gross calculation both exist and differ by more than **10%**, publication is blocked until the recruiter resolves or explicitly corrects the inputs.
- The system must not silently choose one value.

---

## 8. Financial Calculation Contract

Exact semantics:

- **Recurring weekly gross** excludes sign-on bonuses, referral bonuses, orientation bonuses, deposits, and all other one-time amounts.
- **One-time incentives** are displayed separately and never enter gross, net, RPM, or score calculations.
- Recurring amounts may be normalized to weekly **only when amount and frequency are known**.
- `totalKnownWeeklyCosts` is the sum of **relevant, provided, weekly-normalized recurring costs only**.
- **Estimated weekly net** for `contractor_1099`, `owner_operator`, and `lease_purchase` = recurring weekly gross − `totalKnownWeeklyCosts`, labeled **"before taxes"**.
- **Estimated weekly net is unavailable for `company_driver`** under this contract.
- **Effective RPM** = recurring weekly gross ÷ explicit total weekly miles (> 0).
- **Net RPM** = estimated weekly net ÷ explicit total weekly miles (> 0).
- **Deadhead percentage** = explicit deadhead miles ÷ explicit total weekly miles × 100.
- No formula may use a truthiness expression that converts `0` to `null`.
- No formula may count escrow when escrow is not required.
- No amount with unknown frequency may be subtracted from weekly gross.

`financialEstimate.status` is exactly one of:

- `available`
- `incomplete`
- `not_applicable`
- `conflict`

---

## 9. Transparency vs. Earnings

Binding decisions:

- **Replace the conceptual use of "Profit Clarity Score"** in the reconstructed architecture with a **Listing Transparency Score**.
- Listing Transparency Score measures **disclosure completeness and consistency only**.
- It must not claim that a listing is profitable or financially attractive.
- **Earnings Estimate** is a separate object with its own availability status and assumptions.
- Internal admin approval must **not** increase either score.
- Featured placement must **not** increase either score.
- Missing or contradictory facts reduce transparency; unattractive but fully disclosed facts do not.

---

## 10. Driver-Facing Normalization and Rendering

Required behaviors:

- Render only sections **relevant** to the canonical employment model and pay model.
- Suppress individual fields whose state is `not_applicable`.
- Show **"Not disclosed"** only for relevant optional fields explicitly in that state.
- Hide a section when every field is `not_applicable` or absent.
- **Do not create large grids of dashes.**
- Put **one-time incentives** in a separate section.
- Split **Typical Lanes**, **Requirements**, and **Actual Benefits** into separate sections.
- Recruiter preview and driver detail must use the **same labels, units, formatting, and normalized values**.
- Any calculated value must display its **source / assumptions and status**.

---

## 11. Badge and Trust Semantics

Exact definitions:

- **Featured** — paid or administrative placement only; not verification.
- **Recruiter Verified** — may display only when recruiter `verification_status = approved` and the recruiter is not suspended.
- **Internal `admin_review_status`** — publication-control state only; must not display to drivers as "Approved Opportunity".
- **Published** — lifecycle state, not proof of compensation accuracy.
- **HaulTracker Reviewed** — may be introduced only if a separate review process verifies listing content; must not be inferred from current admin approval.
- Profit, transparency, matching, publication, and verification badges must remain **separate** surfaces.

---

## 12. Application and Preference Contract

- Opportunity Preferences improve **matching and recommendations**.
- Incomplete Opportunity Preferences **must not, by themselves, block Apply Now**.
- The Apply action may require only the minimum identity / contact / eligibility information genuinely needed to submit an application.
- When preferences are incomplete, the UI may invite the driver to complete them but must not state they are mandatory unless they truly are.
- **Save**, **Refer**, **Request Info**, and **Apply** are separate actions with independent state.

---

## 13. Legacy Compatibility Rules

- Legacy `benefits` values with `Typical Lanes:` / `Requirements:` markers are split into `typicalLanes` and `requirements`.
- Legacy `benefits` values without markers map to `requirements` only; they **do not** become `actualBenefits`.
- No current row may be assumed to contain actual benefits unless a dedicated future field or explicit recruiter confirmation exists.
- Legacy numeric deduction fields have **unknown frequency** unless separately confirmed; they cannot safely enter weekly net.
- `estimated_loaded_miles = 0` remains an explicit zero and makes an active CPM listing invalid rather than becoming unknown.
- Legacy Team Driver classification remains `employmentModel = unknown` until repaired.
- `min_years_experience` is **not** a stored opportunity field in the current generated schema; experience matching must not claim a requirement match until a canonical stored field exists.
- The Phase 1K-D row-specific migration remains untouched and is **not** part of the structural reconstruction.

---

## 14. Current Field → Canonical Mapping

| Current field | Canonical group | Canonical meaning | Relevance rule | Legacy risk |
|---|---|---|---|---|
| `title` | identity | Listing title | Universal | None |
| `company_name` | identity | Hiring company display name | Universal | May be blank on old rows |
| `hiring_city` | hiringArea.city | Single-city hiring anchor | Universal | Free-text; not normalized |
| `hiring_state` | hiringArea.state | Single-state hiring anchor | Universal | Free-text state code |
| `hiring_states` | hiringArea.states | Multi-state hiring area | Universal | Array; may be empty |
| `driver_type` | classification.employmentModel + classification.teamConfiguration | Split per §3 mapping | Universal | Legacy `team` collapses to `unknown` employment model |
| `route_type` | classification.routeType | Route pattern | Universal | Unrecognized → blocks publish |
| `trailer_type` | classification.trailerType | Trailer requirement | Universal | Unrecognized → blocks publish |
| `description` | content.description | Free-form job description | Universal | May contain mixed content |
| `pay_model` | compensation.payModel | Normalized per §3 | Universal | Unrecognized → `unknown`, blocks publish |
| `cpm` | compensation.recurringPay (CPM) | Rate per loaded mile | CPM only | Zero is explicit and invalid |
| `percentage_pay` | compensation.recurringPay (Percentage) | Percent of revenue | Percentage only | Basis often undocumented |
| `flat_weekly_pay` | compensation.recurringPay (Flat) | Weekly flat amount | Flat/Salary/Mixed | Zero is explicit and invalid |
| `estimated_weekly_gross` | compensation.recurringPay (recruiter-provided gross) | Recruiter-provided gross estimate | Any pay model | Must be labeled recruiter-provided; conflict rule applies |
| `estimated_weekly_miles` | compensation.mileage.totalWeeklyMiles | Total miles including deadhead | CPM/percentage requiring miles | Zero is explicit and invalid for CPM publish |
| `estimated_loaded_miles` | compensation.mileage.loadedWeeklyMiles | Loaded miles only | CPM | Zero remains zero; invalidates active CPM listing |
| `estimated_deadhead_miles` | compensation.mileage.deadheadWeeklyMiles | Deadhead miles | Optional; universal when miles present | May be null; not zero |
| `deadhead_paid` | compensation.mileage.deadheadPaid | Explicit yes/no/unknown | CPM/percentage | `null` ≠ `false`; publish requires explicit boolean |
| `detention_pay` | compensation.accessorialPay.detention | Accessorial | Optional | Text field; not normalized to amount |
| `layover_pay` | compensation.accessorialPay.layover | Accessorial | Optional | Text field; not normalized |
| `sign_on_bonus` | compensation.oneTimeIncentives.signOn | One-time incentive | Optional | Excluded from gross/net/RPM |
| `fuel_paid_by` | costs.fuelPaidBy | Fuel responsibility | Cost-bearing models | Company drivers → `not_applicable` |
| `insurance_deductions` | costs.insurance | Recurring insurance cost | Cost-bearing models | Frequency unknown in schema |
| `escrow_required` | costs.escrow.required | Whether escrow applies | Cost-bearing models | Governs whether `escrow_amount` is counted |
| `escrow_amount` | costs.escrow.amount | Escrow amount | Cost-bearing models & `escrow_required = true` | Not counted when not required |
| `lease_payment` | costs.lease | Recurring lease amount | `lease_purchase` only | Presence on non-lease rows → suppress display |
| `maintenance_deductions` | costs.maintenance | Recurring maintenance cost | Cost-bearing models | Frequency unknown in schema |
| `other_deductions` | costs.other | Recurring other cost | Cost-bearing models | Frequency unknown in schema |
| `home_time` | operatingTerms.homeTime | Home-time statement | Universal | Free-text |
| `forced_dispatch` | operatingTerms.forcedDispatch | Boolean policy | Optional | `null` ≠ `false` |
| `pets_allowed` | operatingTerms.petsAllowed | Boolean policy | Optional | `null` ≠ `false` |
| `riders_allowed` | operatingTerms.ridersAllowed | Boolean policy | Optional | `null` ≠ `false` |
| `equipment_year` | operatingTerms.equipment.year | Equipment year | Optional | May be blank |
| `benefits` | content.typicalLanes + content.requirements (legacy split) | Split by markers per §13 | Content | Never `actualBenefits`; markers-only source of truth |
| `transparency_confirmed` | trust (input to publicationReadiness) | Recruiter accuracy attestation | Universal | Required for publish |
| `status` | trust.lifecycleStatus | Lifecycle state | Universal | Not a driver-facing quality signal |
| `admin_review_status` | trust.internalReviewStatus | Internal review state | Universal | Never rendered as "Approved Opportunity" to drivers |
| `published_at` | trust.publishedAt | Publication timestamp | Universal | Presence ≠ compensation accuracy |
| `featured` | trust.featured | Paid/admin placement flag | Universal | Not verification |
| `view_count` | trust (analytics only) | View counter | Non-canonical for rendering | Must not influence trust badges |

No field above is assumed to carry meaning, frequency, or classification beyond what the current schema establishes.

---

## 15. Type-Level Reference Shape

Non-executable pseudocode for documentation only. Do **not** create a `.ts` file from this section.

```ts
type Disclosure<T> =
  | { state: 'provided'; value: T }
  | { state: 'not_disclosed' }
  | { state: 'not_applicable' };

interface CanonicalOpportunity {
  identity: {
    id: string;
    recruiterId: string;
    title: string;
    companyName: Disclosure<string>;
  };
  classification: {
    employmentModel: 'company_driver' | 'contractor_1099' | 'owner_operator' | 'lease_purchase' | 'unknown';
    teamConfiguration: 'solo' | 'team' | 'solo_or_team' | 'unspecified';
    routeType: Disclosure<string>;
    trailerType: Disclosure<string>;
  };
  hiringArea: {
    city: Disclosure<string>;
    state: Disclosure<string>;
    states: Disclosure<string[]>;
    displayLabel: string;
  };
  compensation: {
    payModel: 'cpm' | 'percentage' | 'flat_weekly' | 'salary' | 'mixed' | 'other' | 'unknown';
    recurringPay: {
      cpm?: Disclosure<number>;
      percentage?: Disclosure<{ value: number; basis: Disclosure<string> }>;
      flatWeekly?: Disclosure<number>;
      salary?: Disclosure<{ amount: number; period: 'weekly' | 'biweekly' | 'monthly' | 'annual' }>;
      recruiterProvidedWeeklyGross?: Disclosure<number>;
    };
    oneTimeIncentives: {
      signOn?: Disclosure<number>;
      referral?: Disclosure<number>;
      orientation?: Disclosure<number>;
      other?: Disclosure<{ label: string; amount: number }[]>;
    };
    mileage: {
      totalWeeklyMiles: Disclosure<number>;
      loadedWeeklyMiles: Disclosure<number>;
      deadheadWeeklyMiles: Disclosure<number>;
      deadheadPaid: Disclosure<boolean>;
    };
    accessorialPay: {
      detention?: Disclosure<string | number>;
      layover?: Disclosure<string | number>;
    };
  };
  operatingTerms: {
    homeTime: Disclosure<string>;
    forcedDispatch: Disclosure<boolean>;
    petsAllowed: Disclosure<boolean>;
    ridersAllowed: Disclosure<boolean>;
    equipment: { year?: Disclosure<number> };
  };
  costs: {
    fuelPaidBy: Disclosure<'company' | 'driver' | 'other'>;
    insurance: Disclosure<{ amount: number; frequency: 'weekly' | 'monthly' | 'other' }>;
    escrow: { required: Disclosure<boolean>; amount: Disclosure<number> };
    lease: Disclosure<{ amount: number; frequency: 'weekly' | 'monthly' | 'other' }>;
    maintenance: Disclosure<{ amount: number; frequency: 'weekly' | 'monthly' | 'other' }>;
    other: Disclosure<{ amount: number; frequency: 'weekly' | 'monthly' | 'other'; label?: string }>;
  };
  content: {
    description: Disclosure<string>;
    typicalLanes: Disclosure<string>;
    requirements: Disclosure<string>;
    actualBenefits: Disclosure<string>;
  };
  trust: {
    lifecycleStatus: 'draft' | 'active' | 'paused' | 'closed';
    internalReviewStatus: 'pending' | 'approved' | 'rejected';
    publishedAt: Disclosure<string>;
    featured: boolean;
    recruiterVerification: 'approved' | 'pending' | 'rejected' | 'suspended' | 'none';
  };
  derived: {
    publicationReadiness: PublicationReadiness;
    financialEstimate: FinancialEstimate;
    transparencyScore: ListingTransparency;
    matchResult?: unknown;
  };
}

interface PublicationReadiness {
  canSaveDraft: boolean;
  canPublish: boolean;
  blockingReasons: string[];
  warnings: string[];
}

interface FinancialEstimate {
  status: 'available' | 'incomplete' | 'not_applicable' | 'conflict';
  recurringWeeklyGross?: { value: number; source: 'derived' | 'recruiter_provided'; assumptions: string[] };
  totalKnownWeeklyCosts?: number;
  estimatedWeeklyNet?: { value: number; label: 'before taxes'; assumptions: string[] };
  effectiveRpm?: number;
  netRpm?: number;
  deadheadPercentage?: number;
  conflicts?: string[];
  missingInputs?: string[];
}

interface ListingTransparency {
  score: number;                 // 0..100, disclosure completeness/consistency only
  band: 'complete' | 'mostly_complete' | 'partial' | 'sparse';
  missingRelevantFields: string[];
  conflicts: string[];
  notes: string[];               // must not describe profitability
}
```

---

## 16. Later-Phase Boundaries

Approved sequence for Phase 1L work:

- **1L-C:** canonical calculation semantics and tests
- **1L-D:** recruiter form reconstruction
- **1L-E:** server-side publication validation
- **1L-F:** driver-page reconstruction
- **1L-G:** legacy data handling and schema decisions
- **1L-H:** regression consolidation
- **1L-I:** production acceptance

**No later phase may begin from this agent run.**
