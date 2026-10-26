-- MUSD Split — schema `split` (idempotent; safe to run repeatedly)
-- Amounts are numeric(78,0) holding MUSD base units (18 decimals) — never floats.

CREATE SCHEMA IF NOT EXISTS split;

CREATE TABLE IF NOT EXISTS split.users (
  address           text PRIMARY KEY CHECK (address ~ '^0x[0-9a-f]{40}$'),
  display_name      text CHECK (display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 40),
  username          text CHECK (username IS NULL OR username ~ '^[a-z0-9_]{3,20}$'),
  avatar_updated_at timestamptz,
  preferences       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_uq ON split.users (username) WHERE username IS NOT NULL;

CREATE TABLE IF NOT EXISTS split.avatars (
  address    text PRIMARY KEY REFERENCES split.users(address) ON DELETE CASCADE,
  mime       text NOT NULL CHECK (mime IN ('image/png','image/jpeg','image/webp')),
  size       integer NOT NULL CHECK (size > 0 AND size <= 524288),
  data       bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS split.auth_nonces (
  nonce      text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);
CREATE INDEX IF NOT EXISTS auth_nonces_expires_idx ON split.auth_nonces (expires_at);

CREATE TABLE IF NOT EXISTS split.groups (
  id                 uuid PRIMARY KEY,
  name               text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  description        text CHECK (description IS NULL OR char_length(description) <= 280),
  icon               text NOT NULL DEFAULT 'users',
  color              text NOT NULL DEFAULT 'violet',
  created_by         text NOT NULL REFERENCES split.users(address),
  members_can_invite boolean NOT NULL DEFAULT true,
  simplify_debts     boolean NOT NULL DEFAULT true,
  currency           text NOT NULL DEFAULT 'MUSD' CHECK (currency = 'MUSD'),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  archived_at        timestamptz
);

CREATE TABLE IF NOT EXISTS split.group_members (
  group_id   uuid NOT NULL REFERENCES split.groups(id) ON DELETE CASCADE,
  address    text NOT NULL REFERENCES split.users(address),
  role       text NOT NULL CHECK (role IN ('owner','admin','member')),
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active','left','removed')),
  joined_at  timestamptz NOT NULL DEFAULT now(),
  left_at    timestamptz,
  invite_id  uuid,
  PRIMARY KEY (group_id, address)
);
CREATE INDEX IF NOT EXISTS group_members_address_idx ON split.group_members (address, status);

CREATE TABLE IF NOT EXISTS split.invites (
  id          uuid PRIMARY KEY,
  group_id    uuid NOT NULL REFERENCES split.groups(id) ON DELETE CASCADE,
  token       text NOT NULL UNIQUE CHECK (char_length(token) >= 24),
  label       text,
  created_by  text NOT NULL REFERENCES split.users(address),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz,
  max_uses    integer CHECK (max_uses IS NULL OR max_uses > 0),
  uses        integer NOT NULL DEFAULT 0,
  revoked_at  timestamptz,
  revoked_by  text
);
CREATE INDEX IF NOT EXISTS invites_group_idx ON split.invites (group_id);

CREATE TABLE IF NOT EXISTS split.receipts (
  id         uuid PRIMARY KEY,
  group_id   uuid NOT NULL REFERENCES split.groups(id) ON DELETE CASCADE,
  uploader   text NOT NULL REFERENCES split.users(address),
  mime       text NOT NULL CHECK (mime IN ('image/png','image/jpeg','image/webp','application/pdf')),
  size       integer NOT NULL CHECK (size > 0 AND size <= 2097152),
  sha256     text NOT NULL,
  filename   text,
  data       bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS receipts_group_idx ON split.receipts (group_id);

CREATE TABLE IF NOT EXISTS split.recurring_expenses (
  id                 uuid PRIMARY KEY,
  group_id           uuid NOT NULL REFERENCES split.groups(id) ON DELETE CASCADE,
  title              text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  amount             numeric(78,0) NOT NULL CHECK (amount > 0),
  payer              text NOT NULL REFERENCES split.users(address),
  category           text NOT NULL,
  split_input        jsonb NOT NULL,
  cadence            text NOT NULL CHECK (cadence IN ('weekly','monthly')),
  interval_count     integer NOT NULL DEFAULT 1 CHECK (interval_count BETWEEN 1 AND 12),
  anchor_day         integer,
  next_run_on        date NOT NULL,
  end_on             date,
  remind_days_before integer NOT NULL DEFAULT 2 CHECK (remind_days_before BETWEEN 0 AND 14),
  last_reminded_for  date,
  active             boolean NOT NULL DEFAULT true,
  created_by         text NOT NULL REFERENCES split.users(address),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  last_run_at        timestamptz
);
CREATE INDEX IF NOT EXISTS recurring_due_idx ON split.recurring_expenses (active, next_run_on);

CREATE TABLE IF NOT EXISTS split.expenses (
  id                uuid PRIMARY KEY,
  group_id          uuid NOT NULL REFERENCES split.groups(id) ON DELETE CASCADE,
  title             text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  amount            numeric(78,0) NOT NULL CHECK (amount > 0),
  currency          text NOT NULL DEFAULT 'MUSD' CHECK (currency = 'MUSD'),
  payer             text NOT NULL REFERENCES split.users(address),
  category          text NOT NULL,
  expense_date      date NOT NULL,
  notes             text CHECK (notes IS NULL OR char_length(notes) <= 500),
  split_method      text NOT NULL CHECK (split_method IN ('equal','custom','percentage','shares')),
  split_input       jsonb NOT NULL,
  receipt_id        uuid REFERENCES split.receipts(id) ON DELETE SET NULL,
  recurring_id      uuid REFERENCES split.recurring_expenses(id) ON DELETE SET NULL,
  recurring_run_on  date,
  created_by        text NOT NULL REFERENCES split.users(address),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  version           integer NOT NULL DEFAULT 1,
  deleted_at        timestamptz,
  deleted_by        text,
  delete_reason     text,
  client_request_id text,
  UNIQUE (group_id, client_request_id),
  UNIQUE (recurring_id, recurring_run_on)
);
CREATE INDEX IF NOT EXISTS expenses_group_idx ON split.expenses (group_id, expense_date DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS split.expense_participants (
  expense_id uuid NOT NULL REFERENCES split.expenses(id) ON DELETE CASCADE,
  address    text NOT NULL REFERENCES split.users(address),
  share      numeric(78,0) NOT NULL CHECK (share >= 0),
  input      text,
  PRIMARY KEY (expense_id, address)
);
CREATE INDEX IF NOT EXISTS expense_participants_address_idx ON split.expense_participants (address);

-- Full audit history of every expense version (snapshot + per-member balance deltas)
CREATE TABLE IF NOT EXISTS split.expense_revisions (
  id            bigserial PRIMARY KEY,
  expense_id    uuid NOT NULL REFERENCES split.expenses(id) ON DELETE CASCADE,
  group_id      uuid NOT NULL REFERENCES split.groups(id) ON DELETE CASCADE,
  version       integer NOT NULL,
  action        text NOT NULL CHECK (action IN ('created','edited','deleted')),
  is_adjustment boolean NOT NULL DEFAULT false,
  reason        text,
  snapshot      jsonb NOT NULL,
  deltas        jsonb NOT NULL,
  actor         text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (expense_id, version)
);

CREATE TABLE IF NOT EXISTS split.payment_requests (
  id                 uuid PRIMARY KEY,
  group_id           uuid NOT NULL REFERENCES split.groups(id) ON DELETE CASCADE,
  requester          text NOT NULL REFERENCES split.users(address),
  payer              text NOT NULL REFERENCES split.users(address),
  amount             numeric(78,0) NOT NULL CHECK (amount > 0),
  note               text CHECK (note IS NULL OR char_length(note) <= 280),
  expense_ids        uuid[] NOT NULL DEFAULT '{}',
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','cancelled','declined','expired')),
  expires_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  closed_at          timestamptz,
  paid_settlement_id uuid,
  CHECK (requester <> payer)
);
CREATE INDEX IF NOT EXISTS payment_requests_payer_idx ON split.payment_requests (payer, status);
CREATE INDEX IF NOT EXISTS payment_requests_requester_idx ON split.payment_requests (requester, status);
CREATE INDEX IF NOT EXISTS payment_requests_group_idx ON split.payment_requests (group_id, created_at DESC);

CREATE TABLE IF NOT EXISTS split.settlement_batches (
  id             uuid PRIMARY KEY,
  group_id       uuid NOT NULL REFERENCES split.groups(id) ON DELETE CASCADE,
  payer          text NOT NULL REFERENCES split.users(address),
  method         text NOT NULL CHECK (method IN ('batch','batch_permit')),
  total          numeric(78,0) NOT NULL CHECK (total > 0),
  status         text NOT NULL DEFAULT 'created' CHECK (status IN ('created','submitted','delayed','confirmed','failed','rejected','cancelled')),
  tx_hash        text UNIQUE CHECK (tx_hash IS NULL OR tx_hash ~ '^0x[0-9a-f]{64}$'),
  block_number   bigint,
  created_block  bigint,
  failure_reason text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  submitted_at   timestamptz,
  confirmed_at   timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS split.settlements (
  id                 uuid PRIMARY KEY,
  group_id           uuid NOT NULL REFERENCES split.groups(id) ON DELETE CASCADE,
  from_address       text NOT NULL REFERENCES split.users(address),
  to_address         text NOT NULL REFERENCES split.users(address),
  amount             numeric(78,0) NOT NULL CHECK (amount > 0),
  method             text NOT NULL CHECK (method IN ('direct','contract','contract_permit','batch','batch_permit')),
  settlement_key     text NOT NULL UNIQUE CHECK (settlement_key ~ '^0x[0-9a-f]{64}$'),
  status             text NOT NULL DEFAULT 'created' CHECK (status IN ('created','submitted','delayed','confirmed','failed','rejected','cancelled')),
  tx_hash            text CHECK (tx_hash IS NULL OR tx_hash ~ '^0x[0-9a-f]{64}$'),
  log_index          integer,
  block_number       bigint,
  block_time         timestamptz,
  chain_id           integer NOT NULL DEFAULT 31611,
  created_block      bigint,
  payment_request_id uuid REFERENCES split.payment_requests(id) ON DELETE SET NULL,
  batch_id           uuid REFERENCES split.settlement_batches(id) ON DELETE SET NULL,
  expense_ids        uuid[] NOT NULL DEFAULT '{}',
  note               text,
  failure_code       text,
  failure_reason     text,
  rejected_tx_hash   text,
  verify_attempts    integer NOT NULL DEFAULT 0,
  last_checked_at    timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  submitted_at       timestamptz,
  confirmed_at       timestamptz,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (from_address <> to_address)
);
-- A transaction hash can back at most one non-batch settlement, ever (no double counting).
CREATE UNIQUE INDEX IF NOT EXISTS settlements_tx_single_uq ON split.settlements (tx_hash) WHERE tx_hash IS NOT NULL AND batch_id IS NULL;
-- Within a batch tx each Settled log backs exactly one settlement.
CREATE UNIQUE INDEX IF NOT EXISTS settlements_tx_log_uq ON split.settlements (tx_hash, log_index) WHERE tx_hash IS NOT NULL AND log_index IS NOT NULL;
CREATE INDEX IF NOT EXISTS settlements_group_idx ON split.settlements (group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS settlements_from_idx ON split.settlements (from_address, status);
CREATE INDEX IF NOT EXISTS settlements_to_idx ON split.settlements (to_address, status);

CREATE TABLE IF NOT EXISTS split.settlement_events (
  id            bigserial PRIMARY KEY,
  settlement_id uuid REFERENCES split.settlements(id) ON DELETE CASCADE,
  batch_id      uuid REFERENCES split.settlement_batches(id) ON DELETE CASCADE,
  from_status   text,
  to_status     text NOT NULL,
  tx_hash       text,
  detail        text,
  actor         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS settlement_events_settlement_idx ON split.settlement_events (settlement_id, id);

CREATE TABLE IF NOT EXISTS split.activity (
  id         bigserial PRIMARY KEY,
  group_id   uuid NOT NULL REFERENCES split.groups(id) ON DELETE CASCADE,
  actor      text,
  type       text NOT NULL,
  data       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activity_group_idx ON split.activity (group_id, id DESC);

CREATE TABLE IF NOT EXISTS split.notifications (
  id         bigserial PRIMARY KEY,
  recipient  text NOT NULL REFERENCES split.users(address),
  group_id   uuid REFERENCES split.groups(id) ON DELETE CASCADE,
  type       text NOT NULL,
  title      text NOT NULL,
  body       text,
  href       text,
  data       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz
);
CREATE INDEX IF NOT EXISTS notifications_recipient_idx ON split.notifications (recipient, id DESC);
CREATE INDEX IF NOT EXISTS notifications_unread_idx ON split.notifications (recipient) WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS split.schema_migrations (
  name       text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
