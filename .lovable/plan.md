# Agency UI Role-Gate Inventory (read-only audit, post AM-1C-FG)

No files were edited, no SQL applied, nothing deployed.

## Start gate

- `git rev-parse HEAD` = `4c85404c7c41dc7ea254a612d635125e7566fc27` (exact match)
- `git status --porcelain` = empty (clean tree, before and after)

## Search scope

`rg` over `src/pages`, `src/components/agency`, `src/components/settlements`, `src/hooks` for
`agency_owner`, `agency_admin`, `agency_member`, `isOwner`, `isOwnerOrAdmin`, `my_role`, plus the
exact string `delegations are not affected`.

`isOwnerOrAdmin` and `is_agency_owner_or_admin`: zero hits in UI code. No Agency workspace consumer
surface still resolves authority from a role label.

## Complete hit inventory

### A — Intentionally owner-only governance (must stay role/owner gated)

| Location | Hit | Note |
| --- | --- | --- |
| `src/components/agency/AgencyPlanLimitsCard.tsx:64` | `const isOwner = agency?.my_role === 'agency_owner'` | Billing identity source for this card |
| `src/components/agency/AgencyPlanLimitsCard.tsx:174` | `showStartCta = isOwner && …` | Stripe checkout start/restart |
| `src/components/agency/AgencyPlanLimitsCard.tsx:180` | `showPortalCta = isOwner && …` | Stripe billing portal |
| `src/components/agency/AgencyPlanLimitsCard.tsx:271` | `{isOwner ? … : "Only the agency owner can manage billing."}` | Billing block |
| `src/pages/AgencyDashboard.tsx:130` | `const isOwner = role === 'agency_owner'` | Feeds only line 163/164 |
| `src/pages/AgencyDashboard.tsx:163` | `{isOwner && <AgencyPlanLimitsCard/>}` | Plan & limits mount |
| `src/pages/AgencyDashboard.tsx:328` | `const isOwner = agency.my_role === 'agency_owner'` (AgencyDetailCard) | Feeds 340/395/429/501 |
| `src/pages/AgencyDashboard.tsx:340` | `{isOwner ? <edit name/desc/contact-email form> : <read-only description>}` | Agency identity mutation |
| `src/pages/AgencyDashboard.tsx:395` | `<AgencySlugCard isOwner={isOwner} />` | Slug / private request link |
| `src/components/agency/AgencySlugCard.tsx:18,71` | `isOwner` prop + `{isOwner ? …}` | Slug management, prop-driven only |
| `src/pages/AgencyDashboard.tsx:429` | `{isOwner && <invite member form>}` | Member invite |
| `src/pages/AgencyDashboard.tsx:501` | `{isOwner && m.role !== 'agency_owner' && m.status !== 'revoked' && <Revoke>}` | Member revoke; the `m.role !== 'agency_owner'` clause is owner-protection, not consumer authority |
| `src/hooks/useAgency.ts:104,107,128` | `invite_agency_member` (`_role` default `'agency_member'`), `revoke_agency_member` | Governance RPC wrappers; server-authoritative |

### B — Migrated workspace consumers (verified clean, no role labels)

| Location | Evidence |
| --- | --- |
| `src/pages/AgencyDashboard.tsx:134-135,138-139,170-182` | Packages/Requests tabs on `canViewPackages`/`canManagePackages`, `canViewClientRequests`/`canManageClientRequests` |
| `src/pages/AgencyDashboard.tsx:142,183-193` | Clients tab on `canViewClients`; `canManageDelegations` passed to `ClientListSection` |
| `src/pages/AgencyDashboard.tsx:149` | Activity tab on `canViewAudit` (AM-1C-FG) |
| `src/pages/AgencyDashboard.tsx:162,404,413,421` | `canViewTeam` drives member list/labels |
| `src/components/agency/ServicePackagesSection.tsx:38-152` | Permission-only gating |
| `src/components/agency/ClientRequestsSection.tsx:57-226` | Permission-only gating |
| `src/components/agency/ClientListSection.tsx:35-80` | `canManageDelegations` only |
| `src/components/agency/WorkQueueSection.tsx:75-235` | `canViewAllWorkItems` / `canManageWorkItems` only |
| `src/components/agency/AgencyAuditSection.tsx` (whole file) | No role logic; server RPC is the authority |

### C — Display-only role labels (not authorization)

| Location | Hit |
| --- | --- |
| `src/pages/AgencyDashboard.tsx:336` | `<Badge>{agency.my_role.replace('agency_','')}</Badge>` |
| `src/pages/AgencyDashboard.tsx:498` | `{m.role.replace('agency_','')} · {m.status}` in the member row |
| `src/components/agency/ClientRequestsSection.tsx:258` | `{m.invite_email} · {m.role.replace('agency_','')}` in the assignee picker |
| `src/hooks/useAgency.ts:5,18` | `AgencyRole` type / `my_role` field declarations |

### D — Stale/incorrect copy or comment

| Location | Text | Why stale |
| --- | --- | --- |
| `src/pages/AgencyDashboard.tsx:516-517` | "…will lose access to your agency. Their driver **delegations are not affected**." | AM-1A member revocation explicitly cascades: `20260816220000_phase_am1a_….sql` §D ("member revocation that cascades to delegations, agency-originated"), lines 600-619 — revoking a member kills that member's agency-originated live delegations and deactivates the derived driver-assistant rows. Only direct, non-agency delegations (`agency_delegation_id IS NULL`) are untouched. The sentence is therefore false for agency-originated delegations. |
| `src/pages/AgencyDashboard.tsx:143-144` | Comment: "Settlements are visible to every active member" | Accurate today, but reads as an authority claim in a file where every other tab comment cites a permission; server RLS is the actual authority. Comment-only. |

### E — Other

| Location | Hit | Explanation |
| --- | --- | --- |
| `src/pages/AgencyDashboard.tsx:164-168` | `{!isOwner && "Billing and plan limits are managed by the agency owner."}` | Explanatory non-owner copy paired with the A-class billing gate. Correct as-is. |
| `src/hooks/useAgency.ts:54` | `list_agency_members` RPC call | Post-FG the RPC itself enforces `team_view` OR exact self-membership; the hook passes no role. Server-authoritative, no UI role derivation. |
| `src/hooks/opportunities/useRecruiterBilling.ts:252-255` | `agencyMembershipRole = myAgency.data?.my_role` | Recruiter billing surface, not Agency UI. Out of the audited consumer scope; flagged for completeness only. |
| `src/hooks/recruiter/useRecruiterTeam.ts:50,95` | `isOwner = role === 'recruiter_owner'` | Recruiter workspace, not Agency. No action. |
| `src/components/settlements/*` | `canManage`, `canViewSettlements` props | No agency role labels anywhere; matches were on the words "owner"/"role" in comments. |

## Smallest recommended UI-only cleanup allowlist

One file, one string. Nothing else in the inventory requires change.

- `src/pages/AgencyDashboard.tsx` — replace the stale revoke-dialog sentence at lines 516-517 so it states that agency-issued delegations for this member end on revocation while delegations a driver granted them directly are unaffected.

Explicitly NOT recommended: no new permissions, no `team_manage`, no change to any A-class owner gate, no Driver Assistant authorization change, no C-class label changes, no comment rewrites.
