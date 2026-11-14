-- Isolated schema for Merchant read/profile and identity-writer tests.
-- This file is only applied to a new merchant_test_* database, never production.
CREATE TABLE users (
  id uuid PRIMARY KEY, role varchar DEFAULT 'USER', full_name varchar(50), email varchar(100),
  phone varchar UNIQUE, phone_hash text, fcm_token text,
  password_hash text, pin_hash text, refresh_token text, status varchar DEFAULT 'ACTIVE',
  created_at timestamp DEFAULT NOW(), updated_at timestamp DEFAULT NOW(), failed_login_attempts integer,
  locked_until timestamp, balance bigint DEFAULT 0, api_key text, secret_key text,
  call_back_url text, totp_enabled boolean DEFAULT false
);
CREATE TABLE user_kyc (
  id varchar PRIMARY KEY, user_id uuid REFERENCES users(id), status varchar,
  dob varchar, gender varchar, address text, front_image_url text, back_image_url text,
  face_image_url text, face_match_score numeric, created_at timestamptz, updated_at timestamptz
);
CREATE TABLE banks (id uuid PRIMARY KEY, name varchar, code varchar, logo_url text);
CREATE TABLE linked_bank_accounts (
  id uuid PRIMARY KEY, user_id uuid REFERENCES users(id), bank_id uuid REFERENCES banks(id),
  account_number varchar, account_holder_name varchar, balance bigint NOT NULL DEFAULT 0,
  is_default boolean, status varchar, created_at timestamptz
);
CREATE TABLE admin_user_change_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admin_id uuid REFERENCES users(id), user_id uuid REFERENCES users(id),
  action varchar(60), reason text, old_values jsonb, new_values jsonb, created_at timestamptz,
  CONSTRAINT chk_admin_change_action CHECK (action IN (
    'USER_PROFILE_UPDATED', 'USER_BLOCKED', 'USER_UNBLOCKED', 'USER_LOGIN_UNLOCKED',
    'MERCHANT_BLOCKED', 'MERCHANT_UNBLOCKED',
    'MERCHANT_FEE_CONFIG_UPDATED', 'SYSTEM_FEE_CONFIG_UPDATED',
    'USER_SESSIONS_REVOKED', 'USER_QR_REGENERATED', 'ADMIN_OP_P2P', 'ADMIN_OP_TOPUP',
    'ADMIN_OP_WITHDRAW', 'DISPUTE_OPENED', 'DISPUTE_UPDATED', 'DISPUTE_RESOLVED'
  ))
);
CREATE TABLE payment_requests (
  id uuid PRIMARY KEY, source_user_id uuid REFERENCES users(id), destination_user_id uuid REFERENCES users(id),
  reference_code varchar, transaction_id varchar, status varchar DEFAULT 'PENDING', created_at timestamptz DEFAULT NOW(),
  amount bigint, description varchar(50), order_id varchar, callback_url text, return_url text,
  expires_at timestamptz DEFAULT NOW() + interval '15 minutes', paid_at timestamptz,
  updated_at timestamptz DEFAULT NOW()
);
CREATE UNIQUE INDEX payment_requests_merchant_order_uk ON payment_requests(destination_user_id, order_id);
CREATE TABLE audit_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_type varchar NOT NULL, payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(), published_at timestamptz, retry_count integer NOT NULL DEFAULT 0
);
CREATE TABLE idempotency_keys (
  idempotency_key varchar PRIMARY KEY, actor_id uuid, actor_type varchar, request_path text, request_hash text,
  status varchar DEFAULT 'PENDING', response_body jsonb, response_status_code integer,
  create_at timestamptz DEFAULT NOW()
);
CREATE TABLE webhook_deliveries (
  id uuid PRIMARY KEY, payment_request_id uuid REFERENCES payment_requests(id),
  merchant_id uuid REFERENCES users(id), event_type varchar, payload jsonb,
  last_http_status integer, created_at timestamptz DEFAULT NOW(),
  UNIQUE (payment_request_id, event_type)
);
CREATE TABLE system_configs (
  key varchar PRIMARY KEY, value jsonb NOT NULL, description text,
  updated_at timestamptz NOT NULL DEFAULT NOW(), updated_by uuid REFERENCES users(id)
);
CREATE TABLE transaction_limit_policies (
  id serial PRIMARY KEY, role varchar NOT NULL, transaction_type varchar NOT NULL,
  min_amount bigint NOT NULL, max_amount bigint NOT NULL, daily_limit bigint,
  updated_at timestamptz NOT NULL DEFAULT NOW(), updated_by uuid REFERENCES users(id),
  UNIQUE (role, transaction_type)
);
CREATE TABLE user_transaction_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  transaction_type varchar NOT NULL, max_amount bigint, daily_limit bigint,
  created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, transaction_type)
);
CREATE SEQUENCE transaction_ref_seq START 1000001;
CREATE TYPE transaction_type_enum AS ENUM ('PAYMENT', 'TRANSFER', 'TOPUP', 'WITHDRAW');
CREATE TABLE transactions (
  id varchar PRIMARY KEY DEFAULT (nextval('transaction_ref_seq'))::varchar,
  transaction_type transaction_type_enum NOT NULL,
  source_user_id uuid REFERENCES users(id), source_balance_before bigint, source_balance_after bigint,
  destination_user_id uuid REFERENCES users(id), dest_balance_before bigint, dest_balance_after bigint,
  amount bigint NOT NULL, fee bigint NOT NULL DEFAULT 0, merchant_fee bigint NOT NULL DEFAULT 0,
  fee_rate_snapshot jsonb, net_amount bigint,
  status varchar NOT NULL DEFAULT 'PENDING', description text, idempotency_key varchar,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at timestamptz DEFAULT NOW(),
  linked_bank_account_id uuid REFERENCES linked_bank_accounts(id)
);
CREATE TABLE merchant_monthly_usage (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month_key varchar(7) NOT NULL,
  withdrawn_amount bigint NOT NULL DEFAULT 0 CHECK (withdrawn_amount >= 0),
  qr_gross_amount bigint NOT NULL DEFAULT 0 CHECK (qr_gross_amount >= 0),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, month_key)
);
CREATE TABLE fee_ledger_entries (
  id uuid PRIMARY KEY,
  transaction_id varchar REFERENCES transactions(id) ON DELETE RESTRICT,
  merchant_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  payer_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  fee_type varchar(30) NOT NULL CHECK (fee_type IN ('QR_FEE', 'USER_FEE', 'WITHDRAW_FEE', 'MONTHLY_PLAN_FEE')),
  amount bigint NOT NULL CHECK (amount >= 0),
  fee_wallet_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  fee_wallet_balance_before bigint NOT NULL,
  fee_wallet_balance_after bigint NOT NULL,
  idempotency_key varchar(120),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (transaction_id, fee_type)
);
INSERT INTO users (id, role, full_name, email, phone, status, balance)
VALUES ('00000000-0000-7000-8000-000000000001', 'SYSTEM', 'SYSTEM_FEE_WALLET', 'system_fee_wallet@system.internal', 'SYS_FEE_01', 'ACTIVE', 0);
INSERT INTO system_configs (key, value, description) VALUES
  ('CONTACT_CHECK_MAX_PHONES', '500'::jsonb, 'Max phones per contact check'),
  ('DAILY_LIMIT_TIMEZONE', '"Asia/Ho_Chi_Minh"'::jsonb, 'Timezone for daily transaction limits'),
  ('EXPORT_MAX_ROWS', '50000'::jsonb, 'Max rows per Excel export'),
  ('HISTORY_PAGE_LIMIT', '20'::jsonb, 'Max items per transaction history page'),
  ('RISK_THRESHOLDS', '{"DEFAULT":{"challenge":40,"block":70},"LOGIN":{"challenge":40,"block":70},"REGISTER":{"challenge":35,"block":60},"SEND_OTP":{"challenge":30,"block":55},"OTP":{"challenge":35,"block":60},"FORGOT":{"challenge":35,"block":60},"TRANSACTION":{"challenge":35,"block":65}}'::jsonb, 'Default risk guard thresholds'),
  ('MERCHANT_FEE_CONFIG', '{"rate_bps":100,"min_fee":200,"max_fee":null,"free_threshold_amount":0,"transfer_fee_bps":0,"transfer_min_fee":0,"transfer_max_fee":null,"withdraw_fee_bps":50,"withdraw_free_quota_per_month":50000000,"monthly_plan_enabled":false,"monthly_plan_fee":0,"monthly_grace_days":7,"tiers":[{"from_amount":0,"rate_bps":100},{"from_amount":50000000,"rate_bps":80},{"from_amount":200000000,"rate_bps":60}]}'::jsonb, 'Default merchant fee config'),
  ('USER_FEE_CONFIG', '{"rate_bps":0,"min_fee":0,"max_fee":null,"free_threshold_amount":0,"transfer_fee_bps":0,"transfer_min_fee":0,"transfer_max_fee":null,"withdraw_fee_bps":0,"withdraw_free_quota_per_month":0,"tiers":[]}'::jsonb, 'Default user fee config');
INSERT INTO transaction_limit_policies (role, transaction_type, min_amount, max_amount, daily_limit) VALUES
  ('MERCHANT', 'TOPUP', 10000, 50000000, 50000000),
  ('MERCHANT', 'WITHDRAW', 10000, 200000000, 500000000),
  ('MERCHANT', 'TRANSFER', 1000, 50000000, 50000000),
  ('MERCHANT', 'QR_PAYMENT', 1000, 50000000, NULL),
  ('MERCHANT', 'SANDBOX_TOPUP', 1000, 50000000, NULL),
  ('USER', 'TOPUP', 10000, 50000000, 50000000),
  ('USER', 'WITHDRAW', 10000, 30000000, 30000000),
  ('USER', 'TRANSFER', 1000, 50000000, 50000000),
  ('USER', 'QR_PAYMENT', 1000, 50000000, NULL),
  ('USER', 'SANDBOX_TOPUP', 1000, 50000000, NULL);
