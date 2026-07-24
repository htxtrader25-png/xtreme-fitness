-- =============================================================================
-- Harbormaster — Houston Harbor Bunker Fleet, Inventory & Commercial Operations
-- PostgreSQL 15+ production DDL schema
-- =============================================================================
--
-- Product code name : Harbormaster
-- Operator          : Fortune 100 energy major (reference tenant)
-- Nomination party  : Buffalo Marine
-- Terminal          : HOFTI (Houston Oil Field Terminal Inc.)
-- Ops tempo         : 24/7/365, Houston Harbor / Houston Ship Channel
--
-- OVERVIEW
-- --------
-- This schema backs the Harbormaster platform: an 8-barge time-chartered bunker
-- fleet, HOFTI terminal storage, commercial contracts, delivery nominations to
-- Buffalo Marine, and an enterprise inventory engine. All inventory movements
-- are recorded double-entry style in inv.inventory_ledger; every derived
-- dimension (Physical / Floating / HOFTI / Reserved / Committed / Uncommitted /
-- Commercial Available / Off-spec / Projected) is computed from ledger movements
-- plus inv.inventory_reservations rather than stored as a mutable balance.
--
-- NAMESPACES
--   ident      identity, RBAC, Entra ID mapping
--   ops        fleet, terminal, tanks, deliveries, loadings, scheduling, AIS
--   inv        products, inventory ledger, reservations, snapshots
--   commercial customers, vessels, contracts, nominations, charters
--   audit      immutable audit log, notifications, alerts, AI recommendations
--
-- CONVENTIONS
--   * PKs are uuid DEFAULT gen_random_uuid()
--   * Mass quantities are numeric(12,3) metric tons (MT)
--   * Volumes reconciled in liters@15C use numeric(14,2)
--   * All timestamps are timestamptz (UTC stored)
--   * Doc-intelligence / flexible payloads use jsonb
--   * updated_at maintained by trigger; mutations shadowed into audit.audit_log
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- exclusion / range indexes

CREATE SCHEMA IF NOT EXISTS ident;
CREATE SCHEMA IF NOT EXISTS ops;
CREATE SCHEMA IF NOT EXISTS inv;
CREATE SCHEMA IF NOT EXISTS commercial;
CREATE SCHEMA IF NOT EXISTS audit;

-- =============================================================================
-- ENUM TYPES
-- =============================================================================

-- Marine fuel product codes (see domain model §Products)
CREATE TYPE inv.product_code AS ENUM (
    'VLSFO',   -- Very Low Sulphur Fuel Oil 0.50% (RMG 380)
    'HSFO',    -- High Sulphur Fuel Oil 3.50% (RMG 380)
    'ULSFO',   -- Ultra Low Sulphur Fuel Oil 0.10%
    'LSMGO',   -- Low Sulphur Marine Gas Oil DMA 0.10%
    'MGO'      -- Marine Gas Oil DMA
);

-- Full ordered operational delivery lifecycle (see domain model §Lifecycle).
-- Ordinal ordering is meaningful: state progression must be monotonic except
-- for the documented Return->Reload->Available loop.
CREATE TYPE ops.delivery_status AS ENUM (
    'available',
    'transit_to_hofti',
    'waiting_to_load',
    'loading',
    'load_complete',
    'inspection_pending',
    'inspection_complete',
    'nomination_draft_ready',
    'nomination_sent',
    'transit_to_customer',
    'waiting_alongside',
    'bunkering',
    'delivery_complete',
    'return_transit',
    'queue_for_reload',
    'available_again'
);

-- Nomination lifecycle toward Buffalo Marine (see domain model §Nomination)
CREATE TYPE commercial.nomination_status AS ENUM (
    'draft_ready',
    'sent',
    'acknowledged',
    'revision_required',
    'revised'
);

CREATE TYPE audit.alert_severity AS ENUM (
    'info',
    'low',
    'medium',
    'high',
    'critical'
);

-- RBAC workspace roles (see domain model §Roles)
CREATE TYPE ident.role_name AS ENUM (
    'commercial_operator',
    'dispatcher',
    'marine_scheduler',
    'blender',
    'trader',
    'commercial_manager',
    'operations_manager',
    'executive_leadership'
);

-- Ledger movement classification driving the enterprise inventory dimensions.
CREATE TYPE inv.ledger_movement_type AS ENUM (
    'replenishment_in',    -- product received into HOFTI tank
    'load_to_barge',       -- HOFTI tank -> barge (Floating gains, HOFTI loses)
    'discharge_to_vessel', -- barge -> customer vessel (Floating loses)
    'heel_adjustment',     -- barge heel true-up
    'transfer',            -- tank<->tank or barge<->barge
    'blend_in',            -- blender component into a product
    'blend_out',           -- blender component out of a product
    'gain_loss',           -- measured gain/loss reconciliation
    'off_spec_flag',       -- reclassify quantity as off-spec
    'off_spec_release',    -- return off-spec quantity to on-spec
    'opening_balance'      -- period opening seed
);

CREATE TYPE inv.reservation_status AS ENUM (
    'active', 'released', 'consumed', 'expired'
);

CREATE TYPE ops.tank_status AS ENUM (
    'in_service', 'out_of_service', 'maintenance', 'off_spec_isolation'
);

CREATE TYPE ops.berth_id AS ENUM ('berth_a', 'berth_b');

-- =============================================================================
-- IDENTITY & RBAC  (schema: ident)
-- =============================================================================

-- Users are provisioned from Microsoft Entra ID; entra_object_id is the OIDC
-- 'oid' claim and is the durable external identity key.
CREATE TABLE ident.users (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entra_object_id uuid NOT NULL UNIQUE,               -- Entra ID 'oid' claim
    entra_tenant_id uuid NOT NULL,
    upn             text NOT NULL UNIQUE,                -- userPrincipalName
    email           text NOT NULL,
    display_name    text NOT NULL,
    job_title       text,
    is_active       boolean NOT NULL DEFAULT true,
    last_login_at   timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ident.roles (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name         ident.role_name NOT NULL UNIQUE,
    display_name text NOT NULL,
    description  text,
    -- Entra ID app role value mapped to this workspace role
    entra_app_role_value text UNIQUE,
    created_at   timestamptz NOT NULL DEFAULT now()
);

-- Fine-grained permissions expressed as resource:action pairs.
CREATE TABLE ident.role_permissions (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id     uuid NOT NULL REFERENCES ident.roles(id) ON DELETE CASCADE,
    resource    text NOT NULL,          -- e.g. 'nomination', 'inventory', 'schedule'
    action      text NOT NULL,          -- e.g. 'read', 'write', 'publish', 'approve'
    constraint_jsonb jsonb,             -- optional ABAC scope (product/barge/terminal)
    UNIQUE (role_id, resource, action)
);

CREATE TABLE ident.user_roles (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES ident.users(id) ON DELETE CASCADE,
    role_id     uuid NOT NULL REFERENCES ident.roles(id) ON DELETE CASCADE,
    granted_by  uuid REFERENCES ident.users(id),
    granted_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz,
    UNIQUE (user_id, role_id)
);

CREATE INDEX ix_user_roles_user ON ident.user_roles(user_id);
CREATE INDEX ix_role_permissions_role ON ident.role_permissions(role_id);

-- =============================================================================
-- PRODUCTS  (schema: inv)
-- =============================================================================

CREATE TABLE inv.products (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code           inv.product_code NOT NULL UNIQUE,
    name           text NOT NULL,
    sulphur_pct    numeric(5,3) NOT NULL,          -- e.g. 0.500, 3.500, 0.100
    iso_grade      text,                           -- e.g. RMG 380, DMA
    reference_density_kg_m3 numeric(7,2),          -- density @15C for L<->MT conversion
    is_active      boolean NOT NULL DEFAULT true,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    CHECK (sulphur_pct >= 0 AND sulphur_pct <= 5)
);

-- =============================================================================
-- TERMINALS & TANKS  (schema: ops)
-- =============================================================================

CREATE TABLE ops.terminals (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code         text NOT NULL UNIQUE,             -- 'HOFTI'
    name         text NOT NULL,                    -- Houston Oil Field Terminal Inc.
    latitude     numeric(9,6),
    longitude    numeric(9,6),
    berth_count  smallint NOT NULL DEFAULT 2,
    timezone     text NOT NULL DEFAULT 'America/Chicago',
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ops.tanks (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    terminal_id           uuid NOT NULL REFERENCES ops.terminals(id),
    code                  text NOT NULL,           -- T-01 .. T-08
    product_id            uuid NOT NULL REFERENCES inv.products(id),
    capacity_mt           numeric(12,3) NOT NULL,  -- shell/gross capacity
    working_capacity_mt   numeric(12,3) NOT NULL,  -- usable between min/max
    minimum_operating_mt  numeric(12,3) NOT NULL DEFAULT 0,
    loading_rate_mt_hr    numeric(8,2),            -- nominal pump rate
    status                ops.tank_status NOT NULL DEFAULT 'in_service',
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    UNIQUE (terminal_id, code),
    CHECK (working_capacity_mt <= capacity_mt),
    CHECK (minimum_operating_mt >= 0)
);

CREATE INDEX ix_tanks_product ON ops.tanks(product_id);

-- Point-in-time snapshot of a tank for the terminal dashboard. Balances here are
-- materialized read-model rows; the ledger remains the source of truth.
CREATE TABLE inv.tank_inventory_snapshots (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tank_id               uuid NOT NULL REFERENCES ops.tanks(id),
    snapshot_at           timestamptz NOT NULL DEFAULT now(),
    current_mt            numeric(12,3) NOT NULL,
    working_mt            numeric(12,3) NOT NULL,
    available_mt          numeric(12,3) NOT NULL,
    reserved_mt           numeric(12,3) NOT NULL DEFAULT 0,
    incoming_replenish_mt numeric(12,3) NOT NULL DEFAULT 0,
    projected_mt          numeric(12,3),
    utilization_pct       numeric(5,2),
    temperature_c         numeric(6,2),
    source                text NOT NULL DEFAULT 'gauging',  -- gauging|ledger_rollup|scada
    created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_tank_snap_tank_time ON inv.tank_inventory_snapshots(tank_id, snapshot_at DESC);

-- =============================================================================
-- FLEET, CHARTERS & OFF-HIRE  (schemas: ops / commercial)
-- =============================================================================

CREATE TABLE ops.barges (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    hull_code          text NOT NULL UNIQUE,       -- HH-201 .. HH-208
    name               text NOT NULL,              -- "San Jacinto", ...
    nominal_capacity_mt numeric(12,3) NOT NULL,
    heel_mt            numeric(12,3) NOT NULL DEFAULT 0,
    imo_number         text,
    mmsi               text,                        -- for AIS correlation
    current_status     ops.delivery_status NOT NULL DEFAULT 'available',
    is_active          boolean NOT NULL DEFAULT true,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_barges_status ON ops.barges(current_status);
CREATE INDEX ix_barges_mmsi ON ops.barges(mmsi);

CREATE TABLE commercial.charter_contracts (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    barge_id           uuid NOT NULL REFERENCES ops.barges(id),
    contract_ref       text NOT NULL UNIQUE,
    owner_disponent    text NOT NULL,              -- time-charter owner
    charter_cost_day   numeric(12,2) NOT NULL,     -- USD/day
    daily_heel_allowance_mt numeric(12,3),
    hire_start         date NOT NULL,
    hire_end           date NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CHECK (hire_end >= hire_start)
);

CREATE INDEX ix_charter_barge ON commercial.charter_contracts(barge_id);

-- Off-hire windows (survey, drydock, weather standdown). Uses a tstzrange with
-- an exclusion constraint so two off-hire windows for the same charter cannot
-- overlap.
CREATE TABLE commercial.off_hire_windows (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    charter_id    uuid NOT NULL REFERENCES commercial.charter_contracts(id) ON DELETE CASCADE,
    reason        text NOT NULL,
    hire_window   tstzrange NOT NULL,
    off_hire      boolean NOT NULL DEFAULT true,   -- false => billable standby
    created_at    timestamptz NOT NULL DEFAULT now(),
    EXCLUDE USING gist (charter_id WITH =, hire_window WITH &&)
);

CREATE INDEX ix_offhire_window ON commercial.off_hire_windows USING gist (hire_window);

-- =============================================================================
-- COMMERCIAL: CUSTOMERS, VESSELS, CONTRACTS, LEAD TIMES  (schema: commercial)
-- =============================================================================

CREATE TABLE commercial.customers (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name          text NOT NULL UNIQUE,            -- Maersk, MSC, CMA CGM, ...
    segment       text,                            -- container | tanker | dry | other
    account_code  text UNIQUE,
    credit_terms  text,
    is_active     boolean NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE commercial.vessels (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id   uuid REFERENCES commercial.customers(id),
    name          text NOT NULL,                   -- "Maersk Sentosa", ...
    imo_number    text UNIQUE,
    mmsi          text,
    vessel_type   text,                            -- container | tanker | ...
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_vessels_customer ON commercial.vessels(customer_id);
CREATE INDEX ix_vessels_mmsi ON commercial.vessels(mmsi);

-- Master commercial supply contracts with the customer.
CREATE TABLE commercial.contracts (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id    uuid NOT NULL REFERENCES commercial.customers(id),
    contract_ref   text NOT NULL UNIQUE,
    incoterm       text,
    pricing_basis  text,                           -- Platts index + differential etc.
    valid_from     date NOT NULL,
    valid_to       date,
    is_active      boolean NOT NULL DEFAULT true,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Contractual nomination lead time obligations (6/12/24/48 hr) per contract/product.
CREATE TABLE commercial.nomination_lead_times (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id   uuid NOT NULL REFERENCES commercial.contracts(id) ON DELETE CASCADE,
    product_id    uuid REFERENCES inv.products(id),   -- null => all products
    lead_time_hours smallint NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CHECK (lead_time_hours IN (6, 12, 24, 48))
);

-- =============================================================================
-- DELIVERIES, LOADINGS, QUEUES  (schema: ops)
-- =============================================================================

CREATE TABLE ops.deliveries (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reference          text NOT NULL UNIQUE,            -- HM-DLV-2026-000123
    customer_id        uuid NOT NULL REFERENCES commercial.customers(id),
    vessel_id          uuid NOT NULL REFERENCES commercial.vessels(id),
    contract_id        uuid REFERENCES commercial.contracts(id),
    product_id         uuid NOT NULL REFERENCES inv.products(id),
    barge_id           uuid REFERENCES ops.barges(id),
    nominated_qty_mt   numeric(12,3) NOT NULL,
    delivered_qty_mt   numeric(12,3),
    delivery_window    tstzrange NOT NULL,
    berth_or_anchorage text,
    latitude           numeric(9,6),
    longitude          numeric(9,6),
    current_status     ops.delivery_status NOT NULL DEFAULT 'available',
    lead_time_hours    smallint,
    created_by         uuid REFERENCES ident.users(id),
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CHECK (nominated_qty_mt > 0)
);

CREATE INDEX ix_deliveries_status ON ops.deliveries(current_status);
CREATE INDEX ix_deliveries_window ON ops.deliveries USING gist (delivery_window);
CREATE INDEX ix_deliveries_customer ON ops.deliveries(customer_id);
CREATE INDEX ix_deliveries_barge ON ops.deliveries(barge_id);
-- Partial index: only open/active deliveries are hot for the dispatch board.
CREATE INDEX ix_deliveries_open ON ops.deliveries(current_status, delivery_window)
    WHERE current_status NOT IN ('delivery_complete', 'available_again');

-- Full status lifecycle history — one row per transition, immutable.
CREATE TABLE ops.delivery_status_history (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_id   uuid NOT NULL REFERENCES ops.deliveries(id) ON DELETE CASCADE,
    from_status   ops.delivery_status,
    to_status     ops.delivery_status NOT NULL,
    changed_by    uuid REFERENCES ident.users(id),
    changed_at    timestamptz NOT NULL DEFAULT now(),
    note          text,
    latitude      numeric(9,6),
    longitude     numeric(9,6)
);

CREATE INDEX ix_dsh_delivery_time ON ops.delivery_status_history(delivery_id, changed_at DESC);

-- A loading is a barge filling from a HOFTI tank at a berth.
CREATE TABLE ops.loadings (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    barge_id          uuid NOT NULL REFERENCES ops.barges(id),
    tank_id           uuid NOT NULL REFERENCES ops.tanks(id),
    terminal_id       uuid NOT NULL REFERENCES ops.terminals(id),
    product_id        uuid NOT NULL REFERENCES inv.products(id),
    berth             ops.berth_id NOT NULL,
    planned_qty_mt    numeric(12,3) NOT NULL,
    loaded_qty_mt     numeric(12,3),
    loading_rate_mt_hr numeric(8,2),
    started_at        timestamptz,
    completed_at      timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CHECK (planned_qty_mt > 0)
);

CREATE INDEX ix_loadings_barge ON ops.loadings(barge_id);
CREATE INDEX ix_loadings_berth_time ON ops.loadings(berth, started_at DESC);

-- Ordered queue of barges waiting for a berth at HOFTI.
CREATE TABLE ops.loading_queue (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    terminal_id    uuid NOT NULL REFERENCES ops.terminals(id),
    barge_id       uuid NOT NULL REFERENCES ops.barges(id),
    loading_id     uuid REFERENCES ops.loadings(id),
    berth          ops.berth_id,
    queue_position smallint NOT NULL,
    eta            timestamptz,
    enqueued_at    timestamptz NOT NULL DEFAULT now(),
    dequeued_at    timestamptz,
    UNIQUE (terminal_id, barge_id, enqueued_at)
);

-- One waiting barge per berth position at any time.
CREATE UNIQUE INDEX ux_loading_queue_active_pos
    ON ops.loading_queue(terminal_id, berth, queue_position)
    WHERE dequeued_at IS NULL;

-- =============================================================================
-- INSPECTIONS + DOCUMENT INTELLIGENCE  (schema: ops)
-- =============================================================================

CREATE TABLE ops.inspections (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    loading_id         uuid REFERENCES ops.loadings(id),
    delivery_id        uuid REFERENCES ops.deliveries(id),
    barge_id           uuid NOT NULL REFERENCES ops.barges(id),
    product_id         uuid NOT NULL REFERENCES inv.products(id),
    inspector_company  text,
    certificate_number text,
    inspected_at       timestamptz,
    -- Reconciliation figures
    gross_qty_mt       numeric(12,3),
    net_qty_mt         numeric(12,3),
    volume_l15c        numeric(14,2),              -- liters @15C
    density_kg_m3      numeric(7,2),
    temperature_c      numeric(6,2),
    sulphur_pct        numeric(5,3),
    water_pct          numeric(5,3),
    is_on_spec         boolean,
    -- Azure AI Document Intelligence output
    document_url       text,                       -- blob storage URI of source PDF
    extracted_fields   jsonb,                      -- raw key/value + confidence map
    extraction_model   text,                       -- doc-intel model id/version
    extraction_confidence numeric(5,4),
    reviewed_by        uuid REFERENCES ident.users(id),
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_inspections_barge ON ops.inspections(barge_id);
CREATE INDEX ix_inspections_delivery ON ops.inspections(delivery_id);
-- Partial index to surface off-spec results quickly.
CREATE INDEX ix_inspections_offspec ON ops.inspections(inspected_at DESC)
    WHERE is_on_spec = false;
CREATE INDEX ix_inspections_extracted ON ops.inspections USING gin (extracted_fields);

-- =============================================================================
-- NOMINATIONS (Buffalo Marine)  (schema: commercial)
-- =============================================================================

CREATE TABLE commercial.nominations (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reference          text NOT NULL UNIQUE,            -- HM-NOM-2026-000123
    delivery_id        uuid NOT NULL REFERENCES ops.deliveries(id),
    counterparty       text NOT NULL DEFAULT 'Buffalo Marine',
    status             commercial.nomination_status NOT NULL DEFAULT 'draft_ready',
    current_revision   smallint NOT NULL DEFAULT 1,
    product_id         uuid NOT NULL REFERENCES inv.products(id),
    nominated_qty_mt   numeric(12,3) NOT NULL,
    delivery_window    tstzrange NOT NULL,
    generated_by_ai    boolean NOT NULL DEFAULT false,
    draft_ready_at     timestamptz,
    sent_at            timestamptz,
    acknowledged_at    timestamptz,
    created_by         uuid REFERENCES ident.users(id),
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_nominations_delivery ON commercial.nominations(delivery_id);
CREATE INDEX ix_nominations_status ON commercial.nominations(status);

-- Immutable revision snapshots — full audit trail of the revision loop.
CREATE TABLE commercial.nomination_revisions (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nomination_id    uuid NOT NULL REFERENCES commercial.nominations(id) ON DELETE CASCADE,
    revision_number  smallint NOT NULL,
    status           commercial.nomination_status NOT NULL,
    payload          jsonb NOT NULL,                  -- full nomination document snapshot
    revision_reason  text,                            -- why Revision Required
    created_by       uuid REFERENCES ident.users(id),
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (nomination_id, revision_number)
);

CREATE TABLE commercial.nomination_recipients (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nomination_id    uuid NOT NULL REFERENCES commercial.nominations(id) ON DELETE CASCADE,
    recipient_name   text NOT NULL,
    recipient_email  text NOT NULL,
    channel          text NOT NULL DEFAULT 'email',   -- email | teams | portal
    delivered_at     timestamptz,
    acknowledged_at  timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_nom_recipients_nom ON commercial.nomination_recipients(nomination_id);

-- =============================================================================
-- ENTERPRISE INVENTORY LEDGER  (schema: inv)
-- =============================================================================

-- Double-entry style movement ledger. Every physical/commercial movement writes
-- one row per affected location. Sign convention: qty_mt is signed (+ into the
-- referenced location, - out of it). Every business event shares an event_id so
-- debits/credits net to zero across the event. This ledger is the single source
-- of truth for all derived inventory dimensions.
CREATE TABLE inv.inventory_ledger (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id         uuid NOT NULL,                   -- groups the balanced legs
    movement_type    inv.ledger_movement_type NOT NULL,
    product_id       uuid NOT NULL REFERENCES inv.products(id),
    -- Exactly one location dimension is populated per leg:
    tank_id          uuid REFERENCES ops.tanks(id),
    barge_id         uuid REFERENCES ops.barges(id),
    terminal_id      uuid REFERENCES ops.terminals(id),
    -- Commercial slicing dimensions (nullable):
    customer_id      uuid REFERENCES commercial.customers(id),
    delivery_id      uuid REFERENCES ops.deliveries(id),
    delivery_window  tstzrange,
    qty_mt           numeric(12,3) NOT NULL,          -- signed
    volume_l15c      numeric(14,2),
    is_off_spec      boolean NOT NULL DEFAULT false,
    is_committed     boolean NOT NULL DEFAULT false,  -- allocated to a delivery
    effective_at     timestamptz NOT NULL DEFAULT now(),
    posted_at        timestamptz NOT NULL DEFAULT now(),
    posted_by        uuid REFERENCES ident.users(id),
    source_ref       text,                            -- loading_id / inspection_id / etc.
    note             text,
    CHECK (qty_mt <> 0),
    -- Exactly one physical location leg
    CHECK (num_nonnulls(tank_id, barge_id) <= 1)
);

CREATE INDEX ix_ledger_event ON inv.inventory_ledger(event_id);
CREATE INDEX ix_ledger_product_time ON inv.inventory_ledger(product_id, effective_at DESC);
CREATE INDEX ix_ledger_tank ON inv.inventory_ledger(tank_id) WHERE tank_id IS NOT NULL;
CREATE INDEX ix_ledger_barge ON inv.inventory_ledger(barge_id) WHERE barge_id IS NOT NULL;
CREATE INDEX ix_ledger_delivery ON inv.inventory_ledger(delivery_id) WHERE delivery_id IS NOT NULL;
-- Partial index for the off-spec dimension.
CREATE INDEX ix_ledger_offspec ON inv.inventory_ledger(product_id, effective_at DESC)
    WHERE is_off_spec = true;

-- Soft holds against available inventory. Reserved reduces Commercial Available;
-- when consumed it becomes Committed via a ledger posting.
CREATE TABLE inv.inventory_reservations (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id       uuid NOT NULL REFERENCES inv.products(id),
    tank_id          uuid REFERENCES ops.tanks(id),
    barge_id         uuid REFERENCES ops.barges(id),
    terminal_id      uuid REFERENCES ops.terminals(id),
    delivery_id      uuid REFERENCES ops.deliveries(id),
    customer_id      uuid REFERENCES commercial.customers(id),
    qty_mt           numeric(12,3) NOT NULL,
    status           inv.reservation_status NOT NULL DEFAULT 'active',
    reserved_from    timestamptz NOT NULL DEFAULT now(),
    expires_at       timestamptz,
    reserved_by      uuid REFERENCES ident.users(id),
    released_at      timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    CHECK (qty_mt > 0)
);

CREATE INDEX ix_reservations_active ON inv.inventory_reservations(product_id, status)
    WHERE status = 'active';
CREATE INDEX ix_reservations_delivery ON inv.inventory_reservations(delivery_id);

-- =============================================================================
-- SCHEDULING / DISPATCH BOARD  (schema: ops)
-- =============================================================================

-- A published, versioned dispatch schedule. Editors work against a draft
-- schedule_version; publishing snapshots the current event set.
CREATE TABLE ops.schedule_versions (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    version_number integer NOT NULL,
    label          text,
    is_published   boolean NOT NULL DEFAULT false,
    published_at   timestamptz,
    published_by   uuid REFERENCES ident.users(id),
    effective_from timestamptz,
    effective_to   timestamptz,
    notes          text,
    created_by     uuid REFERENCES ident.users(id),
    created_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (version_number)
);

-- Only one published version may be effective for a given horizon.
CREATE UNIQUE INDEX ux_schedule_published_current
    ON ops.schedule_versions(is_published)
    WHERE is_published = true AND effective_to IS NULL;

CREATE TABLE ops.schedule_events (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_version_id uuid REFERENCES ops.schedule_versions(id) ON DELETE CASCADE,
    barge_id           uuid REFERENCES ops.barges(id),
    delivery_id        uuid REFERENCES ops.deliveries(id),
    loading_id         uuid REFERENCES ops.loadings(id),
    event_type         text NOT NULL,                  -- load | transit | bunker | offhire | reload
    title              text,
    time_window        tstzrange NOT NULL,
    berth              ops.berth_id,
    status             ops.delivery_status,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_sched_events_version ON ops.schedule_events(schedule_version_id);
CREATE INDEX ix_sched_events_barge_time ON ops.schedule_events(barge_id, time_window);
CREATE INDEX ix_sched_events_window ON ops.schedule_events USING gist (time_window);

-- =============================================================================
-- WEATHER, AIS  (schema: ops)
-- =============================================================================

-- NOAA marine advisories / weather standdowns affecting the ship channel.
CREATE TABLE ops.weather_advisories (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source        text NOT NULL DEFAULT 'NOAA',
    advisory_type text NOT NULL,                       -- fog | small_craft | gale | closure
    headline      text NOT NULL,
    severity      audit.alert_severity NOT NULL DEFAULT 'medium',
    area          text,                                -- Houston Ship Channel segment
    effective     tstzrange NOT NULL,
    payload       jsonb,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_weather_effective ON ops.weather_advisories USING gist (effective);

-- High-volume AIS position stream (partition candidate — see DATA_MODEL.md).
CREATE TABLE ops.ais_positions (
    id            uuid NOT NULL DEFAULT gen_random_uuid(),
    mmsi          text NOT NULL,
    barge_id      uuid REFERENCES ops.barges(id),
    vessel_id     uuid REFERENCES commercial.vessels(id),
    latitude      numeric(9,6) NOT NULL,
    longitude     numeric(9,6) NOT NULL,
    sog_knots     numeric(6,2),                        -- speed over ground
    cog_deg       numeric(6,2),                        -- course over ground
    heading_deg   numeric(6,2),
    nav_status    text,
    received_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id, received_at)
) PARTITION BY RANGE (received_at);

CREATE INDEX ix_ais_mmsi_time ON ops.ais_positions(mmsi, received_at DESC);
CREATE INDEX ix_ais_barge_time ON ops.ais_positions(barge_id, received_at DESC);

-- Example monthly partitions (managed by pg_partman/scheduled job in prod).
CREATE TABLE ops.ais_positions_2026_07 PARTITION OF ops.ais_positions
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE ops.ais_positions_2026_08 PARTITION OF ops.ais_positions
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

-- =============================================================================
-- AUDIT, ALERTS, AI, NOTIFICATIONS  (schema: audit)
-- =============================================================================

CREATE TABLE audit.alerts (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    severity      audit.alert_severity NOT NULL DEFAULT 'info',
    category      text NOT NULL,                       -- inventory | schedule | weather | leadtime
    title         text NOT NULL,
    body          text,
    -- Optional subject references
    barge_id      uuid REFERENCES ops.barges(id),
    tank_id       uuid REFERENCES ops.tanks(id),
    delivery_id   uuid REFERENCES ops.deliveries(id),
    product_id    uuid REFERENCES inv.products(id),
    is_acknowledged boolean NOT NULL DEFAULT false,
    acknowledged_by uuid REFERENCES ident.users(id),
    acknowledged_at timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_alerts_open ON audit.alerts(severity, created_at DESC)
    WHERE is_acknowledged = false;

-- Azure OpenAI dispatch/optimization/copilot recommendations.
CREATE TABLE audit.ai_recommendations (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind          text NOT NULL,                       -- dispatch | reorder | nomination_draft | nl_answer
    subject_type  text,                                -- delivery | barge | schedule | inventory
    subject_id    uuid,
    model         text,                                -- azure openai deployment id
    prompt_ref    text,
    recommendation jsonb NOT NULL,
    confidence    numeric(5,4),
    accepted      boolean,
    acted_by      uuid REFERENCES ident.users(id),
    acted_at      timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_ai_reco_subject ON audit.ai_recommendations(subject_type, subject_id);

CREATE TABLE audit.notifications (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid REFERENCES ident.users(id),
    channel       text NOT NULL DEFAULT 'in_app',      -- in_app | teams | email | outlook
    title         text NOT NULL,
    body          text,
    payload       jsonb,
    related_alert_id uuid REFERENCES audit.alerts(id),
    is_read       boolean NOT NULL DEFAULT false,
    sent_at       timestamptz,
    read_at       timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_notifications_user_unread ON audit.notifications(user_id, created_at DESC)
    WHERE is_read = false;

-- Immutable append-only audit log (partition candidate). Written by triggers and
-- by the application for security-relevant events.
CREATE TABLE audit.audit_log (
    id            uuid NOT NULL DEFAULT gen_random_uuid(),
    schema_name   text NOT NULL,
    table_name    text NOT NULL,
    row_pk        uuid,
    action        text NOT NULL,                       -- INSERT | UPDATE | DELETE
    actor_user_id uuid,
    actor_upn     text,
    old_data      jsonb,
    new_data      jsonb,
    changed_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id, changed_at)
) PARTITION BY RANGE (changed_at);

CREATE INDEX ix_audit_table_time ON audit.audit_log(schema_name, table_name, changed_at DESC);
CREATE INDEX ix_audit_actor ON audit.audit_log(actor_user_id, changed_at DESC);

CREATE TABLE audit.audit_log_2026_07 PARTITION OF audit.audit_log
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE audit.audit_log_2026_08 PARTITION OF audit.audit_log
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

-- =============================================================================
-- TRIGGERS
-- =============================================================================

-- Generic updated_at maintenance.
CREATE OR REPLACE FUNCTION audit.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

-- Generic row-shadow audit trigger. Captures INSERT/UPDATE/DELETE into
-- audit.audit_log. The current actor is read from a session GUC set by the API
-- layer (SET LOCAL app.user_id / app.user_upn per request).
CREATE OR REPLACE FUNCTION audit.log_change()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_pk   uuid;
    v_old  jsonb;
    v_new  jsonb;
BEGIN
    IF (TG_OP = 'DELETE') THEN
        v_old := to_jsonb(OLD);
        v_pk  := (v_old->>'id')::uuid;
    ELSIF (TG_OP = 'UPDATE') THEN
        v_old := to_jsonb(OLD);
        v_new := to_jsonb(NEW);
        v_pk  := (v_new->>'id')::uuid;
    ELSE  -- INSERT
        v_new := to_jsonb(NEW);
        v_pk  := (v_new->>'id')::uuid;
    END IF;

    INSERT INTO audit.audit_log
        (schema_name, table_name, row_pk, action, actor_user_id, actor_upn, old_data, new_data)
    VALUES
        (TG_TABLE_SCHEMA, TG_TABLE_NAME, v_pk, TG_OP,
         NULLIF(current_setting('app.user_id',  true), '')::uuid,
         NULLIF(current_setting('app.user_upn', true), ''),
         v_old, v_new);

    RETURN COALESCE(NEW, OLD);
END;
$$;

-- Attach updated_at triggers to mutable tables.
CREATE TRIGGER trg_users_updated    BEFORE UPDATE ON ident.users            FOR EACH ROW EXECUTE FUNCTION audit.set_updated_at();
CREATE TRIGGER trg_products_updated BEFORE UPDATE ON inv.products           FOR EACH ROW EXECUTE FUNCTION audit.set_updated_at();
CREATE TRIGGER trg_tanks_updated    BEFORE UPDATE ON ops.tanks              FOR EACH ROW EXECUTE FUNCTION audit.set_updated_at();
CREATE TRIGGER trg_barges_updated   BEFORE UPDATE ON ops.barges             FOR EACH ROW EXECUTE FUNCTION audit.set_updated_at();
CREATE TRIGGER trg_deliveries_updated BEFORE UPDATE ON ops.deliveries       FOR EACH ROW EXECUTE FUNCTION audit.set_updated_at();
CREATE TRIGGER trg_nominations_updated BEFORE UPDATE ON commercial.nominations FOR EACH ROW EXECUTE FUNCTION audit.set_updated_at();
CREATE TRIGGER trg_inspections_updated BEFORE UPDATE ON ops.inspections     FOR EACH ROW EXECUTE FUNCTION audit.set_updated_at();

-- Attach audit shadow triggers to high-value business tables.
CREATE TRIGGER trg_deliveries_audit  AFTER INSERT OR UPDATE OR DELETE ON ops.deliveries          FOR EACH ROW EXECUTE FUNCTION audit.log_change();
CREATE TRIGGER trg_nominations_audit AFTER INSERT OR UPDATE OR DELETE ON commercial.nominations   FOR EACH ROW EXECUTE FUNCTION audit.log_change();
CREATE TRIGGER trg_ledger_audit      AFTER INSERT OR UPDATE OR DELETE ON inv.inventory_ledger     FOR EACH ROW EXECUTE FUNCTION audit.log_change();
CREATE TRIGGER trg_user_roles_audit  AFTER INSERT OR UPDATE OR DELETE ON ident.user_roles         FOR EACH ROW EXECUTE FUNCTION audit.log_change();

-- =============================================================================
-- VIEWS
-- =============================================================================

-- v_enterprise_inventory: nets the ledger by product/location into the core
-- enterprise dimensions. Physical = on-spec balance; HOFTI = tank legs; Floating
-- = barge legs; Off-spec = off-spec balance; Committed = committed legs;
-- Reserved comes from active reservations; Commercial Available = Physical -
-- Committed - Reserved - Off-spec.
CREATE OR REPLACE VIEW inv.v_enterprise_inventory AS
WITH led AS (
    SELECT
        product_id,
        SUM(qty_mt)                                              AS physical_mt,
        SUM(qty_mt) FILTER (WHERE tank_id IS NOT NULL)           AS hofti_mt,
        SUM(qty_mt) FILTER (WHERE barge_id IS NOT NULL)          AS floating_mt,
        SUM(qty_mt) FILTER (WHERE is_off_spec)                   AS off_spec_mt,
        SUM(qty_mt) FILTER (WHERE is_committed)                  AS committed_mt
    FROM inv.inventory_ledger
    GROUP BY product_id
),
res AS (
    SELECT product_id, SUM(qty_mt) AS reserved_mt
    FROM inv.inventory_reservations
    WHERE status = 'active'
    GROUP BY product_id
)
SELECT
    p.code                                                       AS product_code,
    p.id                                                         AS product_id,
    COALESCE(led.physical_mt, 0)                                 AS physical_mt,
    COALESCE(led.hofti_mt, 0)                                    AS hofti_mt,
    COALESCE(led.floating_mt, 0)                                 AS floating_mt,
    COALESCE(led.off_spec_mt, 0)                                 AS off_spec_mt,
    COALESCE(led.committed_mt, 0)                                AS committed_mt,
    COALESCE(res.reserved_mt, 0)                                 AS reserved_mt,
    COALESCE(led.physical_mt,0) - COALESCE(led.committed_mt,0)
        - COALESCE(res.reserved_mt,0)                            AS uncommitted_mt,
    COALESCE(led.physical_mt,0) - COALESCE(led.committed_mt,0)
        - COALESCE(res.reserved_mt,0) - COALESCE(led.off_spec_mt,0) AS commercial_available_mt
FROM inv.products p
LEFT JOIN led ON led.product_id = p.id
LEFT JOIN res ON res.product_id = p.id;

-- v_barge_floating_inventory: current on-barge (Floating) balance per barge/product.
CREATE OR REPLACE VIEW inv.v_barge_floating_inventory AS
SELECT
    b.hull_code,
    b.name                                                       AS barge_name,
    p.code                                                       AS product_code,
    SUM(l.qty_mt)                                                AS floating_mt,
    SUM(l.qty_mt) FILTER (WHERE l.is_off_spec)                   AS off_spec_mt,
    MAX(l.effective_at)                                          AS as_of
FROM inv.inventory_ledger l
JOIN ops.barges b   ON b.id = l.barge_id
JOIN inv.products p ON p.id = l.product_id
WHERE l.barge_id IS NOT NULL
GROUP BY b.hull_code, b.name, p.code
HAVING SUM(l.qty_mt) <> 0;

-- v_charter_utilization: charter economics + utilization per barge.
CREATE OR REPLACE VIEW commercial.v_charter_utilization AS
SELECT
    b.hull_code,
    b.name                                                       AS barge_name,
    b.nominal_capacity_mt,
    cc.contract_ref,
    cc.charter_cost_day,
    cc.hire_start,
    cc.hire_end,
    COUNT(d.id) FILTER (WHERE d.current_status = 'delivery_complete') AS completed_deliveries,
    COALESCE(SUM(d.delivered_qty_mt), 0)                        AS total_delivered_mt,
    ROUND(
        100.0 * COALESCE(SUM(d.delivered_qty_mt), 0)
        / NULLIF(b.nominal_capacity_mt * GREATEST(COUNT(d.id), 1), 0)
    , 2)                                                         AS utilization_pct
FROM ops.barges b
LEFT JOIN commercial.charter_contracts cc ON cc.barge_id = b.id
LEFT JOIN ops.deliveries d ON d.barge_id = b.id
GROUP BY b.hull_code, b.name, b.nominal_capacity_mt,
         cc.contract_ref, cc.charter_cost_day, cc.hire_start, cc.hire_end;

-- =============================================================================
-- SEED DATA
-- =============================================================================

-- Products
INSERT INTO inv.products (code, name, sulphur_pct, iso_grade, reference_density_kg_m3) VALUES
    ('VLSFO', 'Very Low Sulphur Fuel Oil 0.50%', 0.500, 'RMG 380', 991.00),
    ('HSFO',  'High Sulphur Fuel Oil 3.50%',     3.500, 'RMG 380', 991.00),
    ('ULSFO', 'Ultra Low Sulphur Fuel Oil 0.10%',0.100, 'RMG 380', 985.00),
    ('LSMGO', 'Low Sulphur Marine Gas Oil 0.10%',0.100, 'DMA',     860.00),
    ('MGO',   'Marine Gas Oil DMA',              0.150, 'DMA',     855.00);

-- Terminal (HOFTI)
INSERT INTO ops.terminals (code, name, latitude, longitude, berth_count) VALUES
    ('HOFTI', 'Houston Oil Field Terminal Inc.', 29.727000, -95.086000, 2);

-- Tanks T-01..T-08 (one product each)
INSERT INTO ops.tanks (terminal_id, code, product_id, capacity_mt, working_capacity_mt, minimum_operating_mt, loading_rate_mt_hr)
SELECT t.id, v.code, p.id, v.cap, v.wcap, v.minop, v.rate
FROM ops.terminals t
JOIN (VALUES
    ('T-01','VLSFO', 30000.000, 28500.000, 1500.000, 900.00),
    ('T-02','VLSFO', 30000.000, 28500.000, 1500.000, 900.00),
    ('T-03','HSFO',  25000.000, 23500.000, 1200.000, 850.00),
    ('T-04','HSFO',  25000.000, 23500.000, 1200.000, 850.00),
    ('T-05','ULSFO', 18000.000, 17000.000, 1000.000, 700.00),
    ('T-06','LSMGO', 15000.000, 14200.000,  800.000, 650.00),
    ('T-07','MGO',   15000.000, 14200.000,  800.000, 650.00),
    ('T-08','VLSFO', 20000.000, 19000.000, 1000.000, 800.00)
) AS v(code, prod, cap, wcap, minop, rate) ON true
JOIN inv.products p ON p.code = v.prod::inv.product_code
WHERE t.code = 'HOFTI';

-- Fleet: 8 time-chartered bunker barges (domain model §Fleet)
INSERT INTO ops.barges (hull_code, name, nominal_capacity_mt, heel_mt, current_status) VALUES
    ('HH-201', 'San Jacinto',    6500.000, 120.000, 'available'),
    ('HH-202', 'Buffalo Bayou',  6500.000, 120.000, 'available'),
    ('HH-203', 'Bolivar',        4200.000,  90.000, 'available'),
    ('HH-204', 'Morgan''s Point',4200.000,  90.000, 'available'),
    ('HH-205', 'Texas City',     8000.000, 150.000, 'available'),
    ('HH-206', 'Baytown',        8000.000, 150.000, 'available'),
    ('HH-207', 'Galveston',      3000.000,  60.000, 'available'),
    ('HH-208', 'Lynchburg',      3000.000,  60.000, 'available');

-- Roles (domain model §Roles)
INSERT INTO ident.roles (name, display_name, entra_app_role_value) VALUES
    ('commercial_operator', 'Commercial Operator', 'Harbormaster.CommercialOperator'),
    ('dispatcher',          'Dispatcher',          'Harbormaster.Dispatcher'),
    ('marine_scheduler',    'Marine Scheduler',    'Harbormaster.MarineScheduler'),
    ('blender',             'Blender',             'Harbormaster.Blender'),
    ('trader',              'Trader',              'Harbormaster.Trader'),
    ('commercial_manager',  'Commercial Manager',  'Harbormaster.CommercialManager'),
    ('operations_manager',  'Operations Manager',  'Harbormaster.OperationsManager'),
    ('executive_leadership','Executive Leadership', 'Harbormaster.Executive');

-- A few baseline role permissions
INSERT INTO ident.role_permissions (role_id, resource, action)
SELECT r.id, x.resource, x.action
FROM ident.roles r
JOIN (VALUES
    ('dispatcher',          'schedule',   'publish'),
    ('dispatcher',          'delivery',   'write'),
    ('marine_scheduler',    'loading',    'write'),
    ('commercial_operator', 'nomination', 'write'),
    ('commercial_manager',  'nomination', 'approve'),
    ('trader',              'inventory',  'read'),
    ('blender',             'inventory',  'write'),
    ('operations_manager',  'inventory',  'read'),
    ('executive_leadership','analytics',  'read')
) AS x(role, resource, action) ON x.role = r.name::text;

-- Customers (domain model §Customers)
INSERT INTO commercial.customers (name, segment, account_code) VALUES
    ('Maersk',   'container', 'CUST-MAERSK'),
    ('MSC',      'container', 'CUST-MSC'),
    ('CMA CGM',  'container', 'CUST-CMACGM'),
    ('Frontline','tanker',    'CUST-FRONTLINE'),
    ('Teekay',   'tanker',    'CUST-TEEKAY'),
    ('ONE',      'container', 'CUST-ONE');

-- Vessels (domain model §Customers/vessels)
INSERT INTO commercial.vessels (customer_id, name, vessel_type)
SELECT c.id, v.name, c.segment
FROM commercial.customers c
JOIN (VALUES
    ('Maersk',   'Maersk Sentosa'),
    ('Maersk',   'Maersk Halifax'),
    ('MSC',      'MSC Ambra'),
    ('MSC',      'MSC Diana'),
    ('CMA CGM',  'CMA CGM Jacques Saade'),
    ('Frontline','Front Altair'),
    ('Teekay',   'Teekay Foundation'),
    ('ONE',      'ONE Innovation')
) AS v(cust, name) ON v.cust = c.name;

-- =============================================================================
-- END OF SCHEMA
-- =============================================================================
