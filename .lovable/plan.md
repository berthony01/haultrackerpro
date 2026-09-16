# CF-1C-B Read-Only Audit — Structured Qualification Authoring + Text Extraction

Read-only. No file was edited, no SQL run, no migration applied, no deploy.

## Gate

Actual HEAD `3743b0e45de3adea2c02885f553c1bd7f8acc887` — matches the stated baseline exactly. Working tree clean. Zero drift.

## Current state of the four inspected surfaces

**`src/lib/opportunities/opportunityCanonical.ts` (795 lines)** — pure authoring boundary, no I/O. Four places would need the three fields:
1. `CanonicalOpportunityAuthoringState` (lines 60–125) — content block currently ends at `requirements`, `actual_benefits`, `transparency_confirmed`.
2. `EMPTY_AUTHORING_STATE` (127–180) — every field has a literal default.
3. `normalizeOpportunityForAuthoring` (233–360) — content precedence block at 348–357.
4. `buildOpportunityPersistencePayload` (710–795) — returns `Omit<TablesInsert<'opportunities'>, ...>`; `requirements` maps at line 790.

`validateOpportunityReadiness` (549–684) is where publication blockers live. The three fields must appear in **none** of the blocker paths, and must not be added to `anyInvalidNumericProvided` (516–532), which turns any non-finite or negative value into the blocker "Fix invalid numeric values" — a draft-blocking path, not just publish.

**`src/components/opportunities/PasteOpportunityDialog.tsx` (173 lines)** — owns the `ExtractedOpportunity` interface (lines 9–46) and the single `extractOpportunityFromText` invocation of `ai-insight` / `parse_opportunity`. Both the paste dialog and the inline "Extract details" action funnel through it.

**`src/components/opportunities/RecruiterOpportunityForm.tsx` (1614 lines)** — four touch points:
- `mergePasteIntoState` (257–330): fill-only-if-blank semantics via `strFill` / `numFill`. Recruiter-typed values always win; the extractor never overwrites.
- Driver Requirements accordion (1000–1025): Description, Typical Lanes, free-text Requirements. The structured controls belong here.
- `DriverPreview` (1339+): builds a `rows: {label, value}[]` list, each row pushed only when its value is present — the natural place for structured criteria rows.
- `handleExtracted` (570–579) and `runInlineExtract` (582–594): both route through `mergePasteIntoState`, so one merge change covers both entry points.

**`supabase/functions/ai-insight/index.ts` (438 lines)** — `parse_opportunity` system prompt (35–50) and `PARSE_OPPORTUNITY_TOOL` schema (135–181). Rule 12 already tells the model to put "experience, CDL class, endorsements, MVR rules, drug test, age requirements" into the free-text `requirements` string. `parse_opportunity` is deliberately outside the Driver Pro gate (lines 296–325) — leave that alone.

## Compatibility risks

1. **The match engine already reads `min_years_experience`.** `opportunityMatch.ts:196` scores it: meeting it is +5, missing it is **−20** with the warning "Experience requirement may not match". Today no row populates the column, so the branch is dead. The moment authoring writes it, newly authored opportunities start scoring differently for drivers — a real behavior change from a UI-only phase. Recommend an explicit acceptance decision and a regression test pinning current match behavior for a null value.
2. **Extractor merge precedence.** `strFill`/`numFill` only fill blanks and only handle `string`/`number` state slots. `required_endorsements` is an array and needs its own guarded fill (fill only when the current list is empty) — do not widen the generic helpers.
3. **`required_endorsements` empty array vs null.** The column is `NOT NULL DEFAULT '{}'`, and generated types expose it as `string[]` (not nullable) on Row/Insert/Update. The payload builder must emit `[]`, never `null`, or the insert violates NOT NULL. The evaluator treats `[]` as "no criterion", so empty is the correct neutral.
4. **`min_years_experience` is `numeric`.** Authoring state stores strings; persistence must emit `null` for blank and a finite number otherwise, with the DB CHECK (`NULL OR >= 0`) mirrored client-side as a field-level validation message, not a publication blocker.
5. **Never infer.** Tanker trailer must not imply N; Hazmat mention in prose must not imply H; "Class A CDL preferred" is a preference, not a requirement. The prompt needs an explicit "only when stated as a requirement" rule, plus an explicit non-inference rule naming trailer type and job type.
6. **The S endorsement.** The evaluator and DB accept S; Driver Work Profile cannot record it. Omitting S from the recruiter picker in this phase avoids creating a criterion no driver can satisfy. The extractor should likewise not emit S.
7. **Free-text `requirements` stays untouched** and continues to drive `manualReviewRequired` in the evaluator and the `requirements` disclosure in `opportunityCanonicalView.ts:334`.

## Test/object-literal impact

Good news: every existing test builds authoring state as `{ ...EMPTY_AUTHORING_STATE, ...overrides }` (`phase1lDE1OpportunityCanonicalAuthoring.test.ts:119`), so adding fields does not break state literals. No test pins an authoring-state key count.

The four opportunity-row fixtures typed against `Tables<'opportunities'>` were already reconciled in the last phase and need no further change.

Residual risk: that suite contains 35 `toEqual` assertions; any that compare a whole persistence payload object will need the three new keys added. Those are mechanical and must be updated by extension, never by switching to `toMatchObject`.

## Minimal allowlist for the CF-1C-B build

Source (4):
- `src/lib/opportunities/opportunityCanonical.ts`
- `src/components/opportunities/PasteOpportunityDialog.tsx`
- `src/components/opportunities/RecruiterOpportunityForm.tsx`
- `supabase/functions/ai-insight/index.ts`

Tests (2 edited + 1 new):
- `src/test/phase1lDE1OpportunityCanonicalAuthoring.test.ts` (extend payload/normalize assertions)
- `src/test/phase1lDE1RecruiterOpportunityForm.test.tsx` (form + merge + preview)
- NEW `src/test/phaseCF1CBStructuredQualificationAuthoring.test.tsx`

Not required and recommended prohibited: `opportunityQualification.ts` (already complete and correct for this phase), `opportunityMatch.ts`, `opportunityCanonicalView.ts`, generated types, any migration, any Driver-side qualification/conversation surface.

## Recommended test suite

New CF-1C-B suite:
1. Empty state defaults: `''`, `''`, `[]` — and `normalizeOpportunityForAuthoring(null)` still equals `EMPTY_AUTHORING_STATE`.
2. Legacy row with all three columns null/`[]` normalizes to the neutral authoring values.
3. Payload: blank → `min_years_experience: null`, `required_cdl_class: null`, `required_endorsements: []` (never `null`).
4. Payload: populated → finite number, `'A'|'B'|'C'`, deduplicated uppercase code array.
5. Readiness: no blocker and no warning is produced by any value or absence of these three, including an invalid experience entry.
6. `requirements` free text is byte-unchanged by every structured path.
7. Merge: extractor fills only when the recruiter slot is blank/empty; a recruiter value is never overwritten.
8. Merge: no endorsement or CDL class is derived from trailer type or job type.
9. Form: the three optional controls render inside the existing Driver Requirements section, S absent from the picker.
10. Preview: each structured criterion renders a visible row when set, and no row when unset.
11. Scope guard: no billing, Telegram, application, conversation, auth, RLS, or migration reference in the CF-1C-B files.
12. Edge-function static guard: prompt carries the explicit non-inference rule; tool schema constrains CDL class to A/B/C and endorsements to the allowed set.

Regression: `phase1lDE1OpportunityCanonicalAuthoring`, `phase1lDE1RecruiterOpportunityForm`, `phase1oARecruiterOpportunityAuthoringReconstruction`, `recruiterOpportunityFormConsolidation`, `phase1lF1CanonicalOpportunityView`, `phase1nRecommendedOpportunityDashboard`, `phaseCF1CAQualificationFoundation`, plus typecheck and production build.

## Open question for the build contract

Item 1 above — the −20 match penalty going live the first time a recruiter sets a minimum-experience value — is a behavior change outside a pure authoring phase. Confirm whether CF-1C-B accepts it as-is, or whether the match-engine branch should be pinned by a regression test only and revisited separately.
