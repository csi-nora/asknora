# Runbook: Operational Data Store (ODS) — Setup & Configuration

| Field | Value |
|-------|-------|
| **Document ID** | RUN-ODS-001 |
| **Version** | 1.0 |
| **Audience** | Data Engineering, SRE, Security, Data Stewards |
| **Context** | Healthcare / SME — Singapore governance (PDPA-aligned) |
| **Status** | Production-ready template (adapt stack placeholders) |
| **Review cadence** | Quarterly + after major incidents |

> **How to use:** Replace `[PLACEHOLDER]` items with your stack. Treat every **Checkpoint** as a gate — do not proceed until Pass/Fail is recorded in the change ticket.

---

## 1. Purpose and scope

### Purpose
Stand up an Operational Data Store that consolidates **near-real-time** operational data from multiple transactional sources to support:

- Operational dashboards and BI
- Automation / RPA / workflow triggers
- Low-latency operational queries (not heavy historical analytics)

### In scope
- RDBMS-backed ODS (on-prem or cloud)
- CDC-based ingestion with light transformation
- Governed read access for analytics and ops
- Observability (SLIs/SLOs), incident runbooks, go-live checklist

### Out of scope (unless explicitly extended)
- Enterprise data warehouse / lake as the primary serving layer
- Full master data management (MDM) golden-record resolution beyond light ID mapping
- Unstructured document stores as primary ODS (use separate KV/object pattern)

### Non-goals
- Replacing OLTP systems of record
- Sub-second analytically complex queries across years of history (route those to EDW/lake)

---

## 2. Prerequisites and ownership

### Ownership RACI (fill before start)

| Role | Name | Contact | On-call? |
|------|------|---------|----------|
| Business owner | `[NAME]` | `[EMAIL/PHONE]` | No |
| Technical owner (Data Eng) | `[NAME]` | `[PAGER]` | Yes |
| SRE / Platform | `[NAME]` | `[PAGER]` | Yes |
| Security / DPO liaison | `[NAME]` | `[EMAIL]` | Escalation |
| Data steward(s) per domain | `[NAME]` | `[EMAIL]` | Ticket |

### Pre-flight checklist

| # | Item | Owner | Done |
|---|------|-------|------|
| P1 | Data sources listed (OLTP DBs, event streams, APIs) | Tech owner | ☐ |
| P2 | Entity inventory (Patient, Encounter, Claim, Invoice, …) | Steward | ☐ |
| P3 | PDPA / sensitivity classification per field (N/R/S/C)* | Security + Steward | ☐ |
| P4 | Data residency decision (SG / APAC / multi-region reject) | DPO + Tech | ☐ |
| P5 | Stack selected (CDC + stream + ODS DB + runtime) | Tech owner | ☐ |
| P6 | Change window + rollback plan approved | Business + SRE | ☐ |
| P7 | Network paths approved (CDC read-only to sources) | Network/Sec | ☐ |

\* **N** = non-sensitive · **R** = restricted · **S** = sensitive personal · **C** = confidential / clinical / NRIC-class

### Suggested technology matrix (pick one column)

| Layer | Option A (cloud-native) | Option B (hybrid/SME) | Option C (enterprise) |
|-------|-------------------------|----------------------|------------------------|
| CDC | Debezium / AWS DMS / Azure DTS | Debezium on VM/K8s | GoldenGate / Informatica |
| Stream | MSK / Confluent / Event Hubs | Kafka (3-broker) or Redis Streams (small SME) | Confluent Platform |
| Process | Flink / Kafka Streams / Lambda | Kafka Connect JDBC + small transform service | Flink + schema registry |
| ODS store | Cloud SQL / Aurora / Azure SQL | Postgres 15+ (primary + 1 replica) | SQL Server Always On / Postgres HA |
| Runtime | EKS / AKS / GKE | Docker Compose / single K8s (k3s) / VMs | OpenShift / enterprise K8s |
| Secrets | Cloud KMS + Secrets Manager | HashiCorp Vault / Windows DPAPI + Vault | Enterprise HSM + Vault |

**Singapore note:** Prefer **SG region** for primary ODS and CDC tooling. Document any cross-border transfer under PDPA transfer requirements; avoid silent multi-region replication for NRIC / health data.

---

## 3. Architecture (reference)

```
┌─────────────┐    ┌──────────┐    ┌────────────┐    ┌──────────────┐    ┌─────────────────┐
│ OLTP / Apps │───▶│   CDC    │───▶│  Kafka /   │───▶│  Stream      │───▶│  ODS (RDBMS)    │
│ + APIs      │    │ connector│    │  stream    │    │  processor   │    │  read-optimised │
└─────────────┘    └──────────┘    └────────────┘    └──────────────┘    └────────┬────────┘
                                                                                  │
                     ┌──────────────────────┐                                     │
                     │ Dashboards / APIs /  │◀────────────────────────────────────┘
                     │ Automation           │
                     └──────────────────────┘
                                        │
                                        ▼ (nightly / hourly)
                               ┌─────────────────┐
                               │ EDW / Data Lake │  ← historical analytics
                               └─────────────────┘
```

**Design principles**
1. OLTP remains system of record; ODS is a **derived**, replayable replica with light enrichment.
2. All writes to ODS are **idempotent upserts** keyed by `(source_system, source_id)`.
3. Soft-delete (`is_deleted`) preferred over hard-delete for auditability.
4. Event-time ≠ ingestion-time — store both.

---

## 4. Environment and infrastructure

### 4.1 Network and tiers

| Tier | Example CIDR | Allowed ingress | Notes |
|------|--------------|-----------------|-------|
| `ods-db` | `[10.x.1.0/24]` | Stream processors, read replicas clients, bastion | No public IP |
| `ods-stream` | `[10.x.2.0/24]` | CDC connectors, processors | Internal only |
| `ods-app` | `[10.x.3.0/24]` | IdP-authenticated apps, BI gateway | TLS terminate here |
| Ops / jump | `[10.x.10.0/24]` | MFA bastion only | Just-in-time access |

**Checkpoint 4.1 — Network**
- [ ] OLTP → CDC is **read-only** path (firewall + DB grants)
- [ ] ODS has no inbound from Internet
- [ ] TLS 1.2+ required between all tiers
- [ ] VPC flow logs / NSG logs enabled

### 4.2 Size starters (SME healthcare — adjust)

| Workload | ODS primary | Replica | Kafka | Processor |
|----------|-------------|---------|-------|-----------|
| Small clinic / SME (<50 TPS) | 4 vCPU / 16 GB / 500 GB gp3 | Optional | 3× small or managed basic | 2 workers |
| Multi-clinic / mid (50–500 TPS) | 8 vCPU / 32 GB / 1 TB | Yes | 3× medium | 4 workers |
| Regional / high (500+ TPS) | 16+ vCPU / 64 GB / RAID or provisioned IOPS | Yes + HA | 6+ brokers | Auto-scale Flink |

Encryption at rest: **ON** (CMK preferred). Weekly snapshot + PITR where available.

### 4.3 Provision commands (templates)

**Postgres (Linux VM example)**

```bash
# Install (Ubuntu 22.04/24.04)
sudo apt-get update && sudo apt-get install -y postgresql-16 postgresql-contrib
sudo systemctl enable --now postgresql

# Create roles and DB (run as postgres)
sudo -u postgres psql <<'SQL'
CREATE ROLE ods_admin LOGIN PASSWORD '[ROTATE_ME]' SUPERUSER;
CREATE ROLE ods_ingest LOGIN PASSWORD '[ROTATE_ME]' NOSUPERUSER;
CREATE ROLE ods_reader LOGIN PASSWORD '[ROTATE_ME]' NOSUPERUSER;
CREATE DATABASE ods OWNER ods_admin;
\c ods
CREATE SCHEMA ods AUTHORIZATION ods_admin;
GRANT USAGE ON SCHEMA ods TO ods_ingest, ods_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA ods
  GRANT SELECT, INSERT, UPDATE ON TABLES TO ods_ingest;
ALTER DEFAULT PRIVILEGES IN SCHEMA ods
  GRANT SELECT ON TABLES TO ods_reader;
SQL
```

**Cloud SQL / Azure SQL / RDS:** Create instance in **SG** region, private IP only, IAM auth if available, rotate passwords into secrets store — never commit credentials.

**Checkpoint 4.2 — Database**
- [ ] ODS DB ≠ OLTP instance
- [ ] Roles `ods_admin` / `ods_ingest` / `ods_reader` created
- [ ] Backups and restore drill scheduled
- [ ] Parameter group tuned (`shared_buffers`, `max_connections`, WAL for CDC consumers if applicable)

---

## 5. Schema design (healthcare + generic SME)

### 5.1 Naming and conventions

| Object | Convention | Example |
|--------|------------|---------|
| Schema | `ods` | `ods.patient` |
| Table | singular business entity | `claim`, `invoice` |
| PK | surrogate or stable business key | `patient_sk` / `patient_id` |
| Natural key | `(source_system, source_<entity>_id)` UNIQUE | |
| Soft delete | `is_deleted BOOLEAN` | |
| Lineage | `source_system`, `record_version`, `event_time`, `ingestion_time` | |
| PII columns | suffix `_hash` or `_enc` when transformed | `nric_hash`, `email_hash` |

### 5.2 Core DDL — healthcare-oriented

```sql
CREATE SCHEMA IF NOT EXISTS ods;

-- Reference: Patient (NCCI / clinic / HIS)
CREATE TABLE ods.patient (
  patient_sk           BIGSERIAL PRIMARY KEY,
  source_system        TEXT NOT NULL,
  source_patient_id    TEXT NOT NULL,
  patient_type         TEXT,                    -- inpatient | outpatient | telehealth
  display_name         TEXT,                    -- prefer display name over full legal name for broad roles
  nric_hash            TEXT,                    -- SHA-256(pepper + NRIC); never store raw NRIC in ODS if avoidable
  dob                  DATE,                    -- sensitivity: S
  sex_code             TEXT,
  phone_hash           TEXT,
  email_hash           TEXT,
  created_at_src       TIMESTAMPTZ,
  updated_at_src       TIMESTAMPTZ,
  event_time           TIMESTAMPTZ NOT NULL,
  ingestion_time       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  record_version       BIGINT NOT NULL DEFAULT 1,
  is_deleted           BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (source_system, source_patient_id)
);

CREATE INDEX ix_patient_event_time ON ods.patient (event_time DESC);
CREATE INDEX ix_patient_active ON ods.patient (source_system) WHERE is_deleted = FALSE;

CREATE TABLE ods.encounter (
  encounter_sk         BIGSERIAL PRIMARY KEY,
  source_system        TEXT NOT NULL,
  source_encounter_id  TEXT NOT NULL,
  source_patient_id    TEXT NOT NULL,
  encounter_type       TEXT,
  facility_code        TEXT,
  admit_ts             TIMESTAMPTZ,
  discharge_ts         TIMESTAMPTZ,
  status               TEXT,
  event_time           TIMESTAMPTZ NOT NULL,
  ingestion_time       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  record_version       BIGINT NOT NULL DEFAULT 1,
  is_deleted           BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (source_system, source_encounter_id)
);

CREATE TABLE ods.claim (
  claim_sk             BIGSERIAL PRIMARY KEY,
  source_system        TEXT NOT NULL,
  source_claim_id      TEXT NOT NULL,
  source_patient_id    TEXT,
  source_encounter_id  TEXT,
  claim_status         TEXT,
  amount_sgd           NUMERIC(14,2),
  currency             TEXT DEFAULT 'SGD',
  event_time           TIMESTAMPTZ NOT NULL,
  ingestion_time       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  record_version       BIGINT NOT NULL DEFAULT 1,
  is_deleted           BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (source_system, source_claim_id)
);

-- SME generic sibling (adapt if not health)
CREATE TABLE ods.customer (
  customer_sk          BIGSERIAL PRIMARY KEY,
  source_system        TEXT NOT NULL,
  source_customer_id   TEXT NOT NULL,
  customer_type        TEXT,
  name                 TEXT,
  uen                  TEXT,                    -- SG business ID if applicable
  email_hash           TEXT,
  event_time           TIMESTAMPTZ NOT NULL,
  ingestion_time       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  record_version       BIGINT NOT NULL DEFAULT 1,
  is_deleted           BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (source_system, source_customer_id)
);

-- Ops metadata
CREATE TABLE ods.ingest_watermark (
  source_system        TEXT NOT NULL,
  entity_name          TEXT NOT NULL,
  last_event_time      TIMESTAMPTZ,
  last_ingestion_time  TIMESTAMPTZ,
  lag_seconds          NUMERIC,
  PRIMARY KEY (source_system, entity_name)
);

CREATE TABLE ods.reconciliation_run (
  run_id               BIGSERIAL PRIMARY KEY,
  entity_name          TEXT NOT NULL,
  window_start         TIMESTAMPTZ NOT NULL,
  window_end           TIMESTAMPTZ NOT NULL,
  source_count         BIGINT,
  ods_count            BIGINT,
  mismatch_count       BIGINT,
  status               TEXT NOT NULL,          -- ok | warn | fail
  details_json         JSONB,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);
```

### 5.3 Column classification register (excerpt)

| Table.column | Class | Handling in ODS | Allowed roles |
|--------------|-------|-----------------|---------------|
| `patient.nric_hash` | C | Hash only; pepper in Vault | `ods_admin`, clinical_breakglass |
| `patient.dob` | S | Store; mask in BI views | `ods_reader_clinical` |
| `patient.display_name` | S | Store | `ods_reader_ops` |
| `claim.amount_sgd` | R | Store | `ods_reader_finance` |
| `encounter.facility_code` | N | Store | all readers |

**Checkpoint 5 — Schema**
- [ ] DDL applied in non-prod first
- [ ] Classification register signed by steward + DPO liaison
- [ ] No raw NRIC / full card PAN in ODS tables
- [ ] Views created for BI with masks (section 7)

---

## 6. CDC and ingestion

### 6.1 Source DB grants (Postgres example)

```sql
-- On SOURCE OLTP (not ODS)
CREATE ROLE cdc_reader LOGIN PASSWORD '[ROTATE_ME]';
GRANT CONNECT ON DATABASE oltp_app TO cdc_reader;
GRANT USAGE ON SCHEMA public TO cdc_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO cdc_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO cdc_reader;
-- For Debezium on PG: also replication privileges per vendor docs
```

### 6.2 Topic naming

```
ods.<source_system>.<schema>.<table>
# Examples:
ods.clinic_his.public.patient
ods.billing.public.claim
```

### 6.3 Debezium connector skeleton (Kafka Connect)

```json
{
  "name": "ods-clinic-his-postgres",
  "config": {
    "connector.class": "io.debezium.connector.postgresql.PostgresConnector",
    "database.hostname": "[OLTP_HOST]",
    "database.port": "5432",
    "database.user": "cdc_reader",
    "database.password": "${file:/secrets/cdc_reader.password}",
    "database.dbname": "oltp_app",
    "topic.prefix": "ods.clinic_his",
    "plugin.name": "pgoutput",
    "slot.name": "ods_clinic_his",
    "publication.name": "ods_pub",
    "table.include.list": "public.patient,public.encounter,public.claim",
    "tombstones.on.delete": "false",
    "decimal.handling.mode": "string",
    "time.precision.mode": "adaptive_time_microseconds",
    "heartbeat.interval.ms": "10000"
  }
}
```

Deploy:

```bash
curl -sS -X PUT -H "Content-Type: application/json" \
  --data @connectors/ods-clinic-his-postgres.json \
  http://[CONNECT_HOST]:8083/connectors/ods-clinic-his-postgres/config
curl -sS http://[CONNECT_HOST]:8083/connectors/ods-clinic-his-postgres/status | jq .
```

**Checkpoint 6.1 — CDC**
- [ ] Snapshot completed (or intentional incremental-only documented)
- [ ] Deletes captured (`op=d` or equivalent)
- [ ] Connector status `RUNNING` for 24h soak
- [ ] Consumer lag dashboards green

### 6.4 Stream processor — upsert contract

Pseudo-logic (implement in Flink / Kafka Streams / worker):

```
onEvent(e):
  key = (e.source_system, e.source_id)
  if e.op in ('d', 'delete'):
    UPSERT ods.<entity> SET is_deleted=true, event_time=e.ts, ingestion_time=now(),
           record_version = GREATEST(record_version, e.version)
    WHERE source_system=key.sys AND source_<id>=key.id
  else:
    if existing.record_version > e.version: ignore  # out-of-order
    UPSERT mapped columns + event_time + ingestion_time + record_version
  update ods.ingest_watermark
```

**Idempotent SQL pattern (Postgres)**

```sql
INSERT INTO ods.patient AS t (
  source_system, source_patient_id, display_name, nric_hash, dob,
  event_time, ingestion_time, record_version, is_deleted
) VALUES (
  $1, $2, $3, $4, $5, $6, NOW(), $7, FALSE
)
ON CONFLICT (source_system, source_patient_id) DO UPDATE SET
  display_name   = EXCLUDED.display_name,
  nric_hash      = EXCLUDED.nric_hash,
  dob            = EXCLUDED.dob,
  event_time     = EXCLUDED.event_time,
  ingestion_time = NOW(),
  record_version = EXCLUDED.record_version,
  is_deleted     = FALSE
WHERE t.record_version <= EXCLUDED.record_version;
```

### 6.5 Optional: OIPA-style “Run” controls (utility pattern)

If using an ODS utility similar to Oracle OIPA ODS:

| Control | Guidance |
|---------|----------|
| **Run definition** | Versioned job pack: DDL + sync + schedule |
| **Aggregation** | Patients by facility; Claims by status/day |
| **Job scheduler** | Critical entities: 1–5 min; reference data: 15–60 min |
| **Alias mapping** | `HIS_PAT_MASTER` → `Patient` in catalog / BI |

Ops sequence: Add Run → generate DDL → review → apply → enable sync → watch lag.

**Checkpoint 6.2 — Pipeline**
- [ ] End-to-end: insert on source → visible in ODS within SLO
- [ ] Soft-delete test passes
- [ ] Out-of-order version test passes
- [ ] Watermark table updating

---

## 7. Security, governance, and access (Singapore)

### 7.1 RBAC matrix

| Role | Privileges | Typical users |
|------|------------|---------------|
| `ods_ingest` | INSERT/UPDATE on ODS tables | Stream workers only |
| `ods_reader_ops` | SELECT on non-clinical views | Ops dashboards |
| `ods_reader_clinical` | SELECT including clinical views | Care quality / limited BI |
| `ods_reader_finance` | Claims / amounts views | Finance |
| `ods_admin` | DDL + grants | Data Eng + break-glass |
| `ods_auditor` | SELECT on audit logs | Compliance |

### 7.2 Masked view example

```sql
CREATE OR REPLACE VIEW ods_bi.v_patient_ops AS
SELECT
  patient_sk,
  source_system,
  source_patient_id,
  patient_type,
  CASE
    WHEN current_setting('app.role', true) = 'clinical'
      THEN display_name
    ELSE CONCAT(LEFT(display_name, 1), '***')
  END AS display_name,
  -- never expose nric_hash in ops BI unless justified
  DATE_TRUNC('year', dob)::date AS dob_year,
  event_time,
  ingestion_time,
  is_deleted
FROM ods.patient
WHERE is_deleted = FALSE;

GRANT SELECT ON ods_bi.v_patient_ops TO ods_reader_ops;
```

### 7.3 Controls checklist (PDPA-aligned)

| Control | Implementation | Evidence |
|---------|----------------|----------|
| Purpose limitation | Document purpose in catalog | Policy + catalog entry |
| Consent / notification | Align with upstream HIS/CRM notices | Legal sign-off |
| Access control | RBAC + MFA for humans | IAM export |
| Encryption in transit | TLS everywhere | Config scan |
| Encryption at rest | CMK / TDE | Cloud console / LUKS |
| Retention | ODS hot 90–180 days; archive to EDW | Retention job |
| Breach readiness | Alert + runbook 9.x | Tabletop record |
| Cross-border | Default deny; DPIA if transfer | DPIA doc |
| Vendor | DPA for managed Kafka/DB | Signed DPA |

### 7.4 Audit

Log at minimum: admin DDL, role grants, queries touching `*_hash` / clinical views, connector credential rotations.

```sql
-- Example: enable PG audit extension or cloud SQL audit; retain ≥ 180 days for sensitive access
```

**Checkpoint 7 — Security**
- [ ] Threat model reviewed (STRIDE light)
- [ ] Secrets only in Vault / Secret Manager
- [ ] BI users use views, not base tables
- [ ] DPO liaison acknowledged classification register

---

## 8. Observability — SLIs, SLOs, alerts

### 8.1 Service level objectives

| SLI | Definition | SLO (starter) | Window |
|-----|------------|---------------|--------|
| Ingest latency | Source commit → ODS row visible (p95) | ≤ 30 s critical; ≤ 2 min standard | 30d |
| Freshness | % entities with watermark lag ≤ threshold | ≥ 99% within 60 s (critical) | 30d |
| Read success | Successful ODS queries / total | ≥ 99.9% | 30d |
| Query latency | p95 for approved operational queries | ≤ 200 ms | 30d |
| Schema error rate | Failures / events | < 0.1% | 7d |
| Duplicate key rate | Dup natural keys / total | < 0.01% | 7d |
| Availability | ODS primary accepting connections | ≥ 99.9% | 30d |

Error budget: e.g. 0.1% monthly unavailability ≈ **43 minutes** — freeze risky changes when burned >50%.

### 8.2 Watermark lag query

```sql
SELECT source_system, entity_name,
       EXTRACT(EPOCH FROM (NOW() - last_event_time)) AS lag_sec
FROM ods.ingest_watermark
ORDER BY lag_sec DESC NULLS LAST;
```

### 8.3 Dashboards

| Dashboard | Audience | Panels |
|-----------|----------|--------|
| Executive | Leadership | Freshness SLA, ingest p95, read success, open sev-1 |
| On-call | SRE | Connector status, consumer lag, DB CPU/IO, schema errors, recon status |
| Debug | Data Eng | Per-partition lag, failed event samples, slow upsert queries |

### 8.4 Alert routing

| Condition | Severity | Action |
|-----------|----------|--------|
| Critical entity lag > 2× SLO for 5 min | Sev-1 page | Runbook 9.1 |
| Read success < 99% for 5 min | Sev-1 page | Runbook 9.4 |
| Schema error rate > 1% for 10 min | Sev-2 ticket+Slack | Runbook 9.2 |
| Disk > 80% | Sev-3 ticket | Capacity playbook |
| Recon mismatch_count > threshold | Sev-2 | Runbook 9.3 |

---

## 9. Incident runbooks

### 9.1 Connector down / ingestion lag

**Symptoms:** Dashboards stale; consumer lag rising; watermark lag alerts.

1. Check connector status (`/connectors/<name>/status`) and last restart reason.
2. Verify source DB reachability and `cdc_reader` credentials (secret expiry common cause).
3. Inspect Kafka lag by partition; look for hot partitions / poison messages.
4. If crashed: restart connector; if OOM/backpressure: scale consumers or raise partitions (coordinated).
5. Validate freshness SLI; capture timeline for IC.

### 9.2 Schema change causing ingest errors

**Symptoms:** Schema error spike; null/missing fields; DLQ growth.

1. Identify topic/table + change ticket / migration.
2. Diff source schema vs processor mapping / registry compatibility.
3. Update mapping + registry (FORWARD/FULL compatibility preferred).
4. Replay from offset or trigger CDC re-snapshot for affected tables.
5. Add contract test in CI (consumer schema test on PR).

### 9.3 Source vs ODS divergence

**Symptoms:** Count/status mismatches; user-reported wrong state.

1. Run recon job for entity + time window → `ods.reconciliation_run`.
2. Classify: missing inserts, missed deletes, version races.
3. Replay window with idempotent upserts.
4. Fix root cause (filter bug, clock skew, failed batch).
5. Tighten alert threshold if detection was late.

**Sample recon (counts):**

```sql
-- Compare approx counts for a window (pair with source-side query in job)
SELECT COUNT(*) AS ods_count
FROM ods.patient
WHERE event_time >= :window_start
  AND event_time <  :window_end
  AND source_system = :sys
  AND is_deleted = FALSE;
```

### 9.4 Query performance degradation

**Symptoms:** p95 latency↑; dashboard timeouts.

1. Check CPU, IO, locks, connection saturation.
2. Identify top queries (`pg_stat_statements` / Query Insights).
3. Add indexes / fix SELECT * from base tables / use BI views.
4. Consider materialised views for hot aggregates (refresh on schedule).
5. Scale vertically/horizontally if capacity-bound; protect OLTP from accidental ODS co-hosting.

---

## 10. Testing and validation

| Test | Pass criteria |
|------|----------------|
| Load test | Peak TPS + concurrent queries; all SLIs green |
| Fail connector | Restart recovers; lag clears within error budget |
| Fail processor | No duplicate business keys after catch-up |
| Schema break (staging) | Alert fires; DLQ holds; runbook 9.2 timed |
| Soft-delete | Source delete → `is_deleted=true` in ODS |
| Recon game day | Injected mismatch detected and remediated |
| Backup restore | Restore to new instance; sample queries match |
| Access review | Non-authorised role cannot SELECT clinical base table |

---

## 11. Go-live checklist

| Gate | Evidence | Sign-off |
|------|----------|----------|
| Owners + on-call rota published | Pager schedule URL | SRE |
| SLIs/SLOs on live dashboards | Screenshot / link | SRE |
| Alerts page correctly with runbook links | Test page | SRE |
| Security review (RBAC, encryption, audit) | Ticket | Security |
| PDPA / residency attestation | Form | DPO liaison |
| Backup + restore tested | Restore ticket | DBA |
| Data stewards trained | Attendance | Steward |
| Rollback plan (disable connector / freeze BI) | Doc | Tech owner |
| Comms to consumers (API/BI owners) | Email/Slack | Business |

**Go / No-Go** meeting: Business + Tech + SRE + Security. Record decision in change record.

---

## 12. Operating model

| Cadence | Activity |
|---------|----------|
| Daily | Glance on-call ODS dashboard; ack overnight recon |
| Weekly | Connector health, lag trends, failed events review |
| Monthly | Capacity/cost; schema-change audit; access review sample |
| Quarterly | DR drill; runbook update; SLO tuning; DPIA refresh if scope changed |
| Per incident | Blameless postmortem with ingest latency timeline + error budget burn |

---

## 13. Appendix

### A. Glossary

| Term | Meaning |
|------|---------|
| ODS | Near-real-time operational consolidated store |
| CDC | Change Data Capture from OLTP |
| Watermark | Latest successfully applied event time per entity |
| Soft delete | Row retained with `is_deleted=true` |
| EDW | Enterprise Data Warehouse (historical) |

### B. Document control

| Version | Date | Author | Notes |
|---------|------|--------|-------|
| 1.0 | 2026-07-15 | Platform / Data | Initial Singapore healthcare/SME template |

### C. Tailoring prompt (give to your implementer)

> Our stack is: **`[e.g. Postgres 16 + Debezium + Kafka on EKS in ap-southeast-1]`**.  
> Entities: **`[Patient, Encounter, Claim, …]`**.  
> Produce connector JSON, processor config, Kubernetes manifests, Grafana panels, and Alertmanager rules matching RUN-ODS-001 SLOs.

### D. Related (do not confuse)

This runbook covers an **Operational Data Store** (data platform). It is unrelated to the Osmantic **ODS** local AI server or NSX Online Diagnostic System unless those are separate workstreams.

---

## Sources (orientation)

1. Operational Data Store — architecture & examples (industry primers).  
2. Oracle OIPA ODS Utility — Run / aggregation / scheduler conceptual pattern.  
3. PDPA (Singapore) — personal data protection obligations for organisations.  
4. Your internal ISMS / HITRUST-like / MOH circulars — attach as binding overlays.
