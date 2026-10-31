# Fase 89 — Diagnóstico de Process Intelligence

## Escopo revisado antes da implementação

- Event sources: domain tables/events, audit trails and timestamps already emitted by Orders, KDS, Procurement, WMS, TMS, Incidents, Integrations and Change Management.
- Data Platform (Fase 34): remains the analytical ingestion, facts/dimensions, semantic metrics and lineage owner.
- Data Governance (Fase 76): remains the source for contracts, lineage, ownership, quality and schema impact.
- Automation Center (Fase 50): remains the only workflow/automation executor; Process Intelligence creates drafts only.
- Incident Management (Fase 59), Integration Orchestration (Fase 81) and Change Management (Fase 88): remain canonical operational timelines.
- Reporting, Workspace, Executive Command Center and Policy Engine remain their respective presentation/governance owners.

## Existing traceability

Strong initial coverage exists for `order_to_kitchen`, `incident_to_recovery`, `change_to_validation` and `integration_to_reconciliation` because their entities carry stable IDs and server timestamps. Procurement/WMS/TMS have usable IDs but activity coverage depends on the source deployment. Customer support and campaign processes are partial.

## Gaps and decisions

- There is no canonical cross-domain analytical process event log. Phase 89 adds one, containing references and analytical attributes rather than raw payloads.
- Existing domain events are not replaced or copied wholesale. Versioned mappings translate authoritative events into analytical activities.
- Missing activities remain missing; reconstructed events require explicit safe derivation and quality labels.
- Event ingestion and analysis are asynchronous and never part of orders, payments, stock or kitchen request paths.
- Process definitions and expected models are analytical/conformance artifacts, not BPM runtime definitions.
- Comparisons expose sample, coverage and peer context; no employee ranking is produced.
- Temporal before/after and incident/change relations are correlations, never automatic causality.

## Reuse map

| Concern | Canonical source | Phase 89 role |
| --- | --- | --- |
| Events and audit | Domain modules/Event Bus | Reference and map |
| Analytics | Data Platform | Store aggregates and lineage |
| Contracts/quality | Data Governance | Validate mappings and coverage |
| Automation | Automation Center | Receive approved draft only |
| Policy | Policy Engine | Required steps and allowed bypass |
| Changes | Change Management | Markers and before/after evidence |
| Incidents | Incident Management | Canonical incident timeline |
| Knowledge/SOP | Knowledge Base | Expected-model source reference |

## Security and scale posture

All new tables are tenant-scoped, RLS-enabled and service-role-only. Process event data contains IDs/references and minimized attributes, not customer payloads. Event-time indexes, dedup keys and aggregate read models keep UI queries away from raw OLTP. Large analysis runs are queued, cancellable and reproducible by mapping/model version.

