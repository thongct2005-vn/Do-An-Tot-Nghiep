-- Isolated schema for Merchant read/profile and identity-writer tests.
-- This file is only applied to a new merchant_test_* database, never production.
CREATE TABLE users (
  id uuid PRIMARY KEY, role varchar DEFAULT 'USER', full_name varchar(50), email varchar(100),
  phone varchar UNIQUE, phone_hash text, fcm_token text,
  password_hash text, pin_hash text, refresh_token text, status varchar DEFAULT 'ACTIVE',
  created_at timestamp DEFAULT NOW(), updated_at timestamp DEFAULT NOW(), failed_login_attempts integer,
  locked_until timestamp, balance bigint DEFAULT 0, api_key text, secret_key text,
  call_back_url text, totp_secret text, totp_enabled boolean DEFAULT false,
  totp_last_step bigint, totp_failed_attempts integer DEFAULT 0, totp_locked_until timestamptz,
  credentials_revoked boolean NOT NULL DEFAULT false,
  credentials_revision bigint NOT NULL DEFAULT 0,
  must_change_password boolean NOT NULL DEFAULT false
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
    'USER_CREATED', 'MERCHANT_CREATED', 'MERCHANT_BLOCKED', 'MERCHANT_UNBLOCKED',
    'MERCHANT_CREDENTIALS_ISSUED', 'MERCHANT_CREDENTIALS_ROTATED',
    'MERCHANT_CREDENTIALS_REVOKED', 'MERCHANT_CREDENTIALS_REISSUED',
    'MERCHANT_FEE_CONFIG_UPDATED', 'SYSTEM_FEE_CONFIG_UPDATED',
    'USER_SESSIONS_REVOKED', 'USER_QR_REGENERATED', 'ADMIN_OP_P2P', 'ADMIN_OP_TOPUP',
    'ADMIN_OP_WITHDRAW', 'DISPUTE_OPENED', 'DISPUTE_UPDATED', 'DISPUTE_RESOLVED'
  ))
);
CREATE TABLE payment_requests (
  id uuid PRIMARY KEY, destination_user_id uuid REFERENCES users(id),
  reference_code varchar, transaction_id varchar, status varchar DEFAULT 'PENDING', created_at timestamptz DEFAULT NOW(),
  amount bigint, description varchar(50), order_id varchar, callback_url text, return_url text,
  expires_at timestamptz DEFAULT NOW() + interval '15 minutes', paid_at timestamptz,
  updated_at timestamptz DEFAULT NOW(), credentials_revision bigint
);
CREATE UNIQUE INDEX payment_requests_merchant_order_uk ON payment_requests(destination_user_id, order_id);
CREATE TABLE audit_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_type varchar NOT NULL, payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(), published_at timestamptz, retry_count integer NOT NULL DEFAULT 0
);
CREATE TABLE idempotency_keys (
  idempotency_key varchar PRIMARY KEY, actor_id uuid, actor_type varchar, request_path text, request_hash text,
  status varchar DEFAULT 'PENDING', response_body jsonb, response_status_code integer,
  create_at timestamptz DEFAULT NOW(),
  expires_at timestamptz DEFAULT NOW() + interval '7 days'
);
CREATE TABLE webhook_deliveries (
  id uuid PRIMARY KEY, payment_request_id uuid REFERENCES payment_requests(id),
  merchant_id uuid REFERENCES users(id), event_type varchar, payload jsonb,
  last_http_status integer, created_at timestamptz DEFAULT NOW(),
  status varchar NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SUCCESS','FAILED')),
  attempt_count integer NOT NULL DEFAULT 0, max_attempts integer NOT NULL DEFAULT 8,
  next_retry_at timestamptz NOT NULL DEFAULT NOW(), last_error text, delivered_at timestamptz,
  UNIQUE (payment_request_id, event_type)
);
CREATE TABLE system_configs (
  key varchar PRIMARY KEY, value jsonb NOT NULL, description text,
  updated_at timestamptz NOT NULL DEFAULT NOW(), updated_by uuid REFERENCES users(id)
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
  fee_type varchar(30) NOT NULL CHECK (fee_type IN ('QR_FEE', 'USER_FEE', 'WITHDRAW_FEE', 'MONTHLY_PLAN_FEE', 'POSTPAID_LATE_FEE', 'POSTPAID_SERVICE_FEE')),
  amount bigint NOT NULL CHECK (amount >= 0),
  fee_wallet_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  fee_wallet_balance_before bigint NOT NULL,
  fee_wallet_balance_after bigint NOT NULL,
  idempotency_key varchar(120),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (transaction_id, fee_type)
);
CREATE TABLE postpaid_wallets (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  status varchar(20) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('INACTIVE', 'ACTIVE', 'PAST_DUE', 'FROZEN')),
  credit_limit bigint NOT NULL CHECK (credit_limit >= 0),
  used_amount bigint NOT NULL DEFAULT 0 CHECK (used_amount >= 0),
  billed_amount bigint NOT NULL DEFAULT 0 CHECK (billed_amount >= 0),
  service_fee_amount bigint NOT NULL DEFAULT 0 CHECK (service_fee_amount >= 0),
  late_fee_amount bigint NOT NULL DEFAULT 0 CHECK (late_fee_amount >= 0),
  current_cycle_month varchar(7),
  due_date date,
  last_reminder_month varchar(7),
  activated_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_postpaid_debt_bounds
    CHECK (billed_amount + service_fee_amount + late_fee_amount <= used_amount)
);
CREATE INDEX idx_postpaid_wallets_debt_reminder
  ON postpaid_wallets (last_reminder_month, user_id)
  WHERE used_amount > 0 AND status IN ('ACTIVE', 'PAST_DUE', 'FROZEN');
CREATE OR REPLACE FUNCTION public.uuid_generate_v7()
RETURNS uuid
AS $$
  SELECT encode(
    set_byte(b, 6, (get_byte(b, 6) & 15) | 112),
    'hex'
  )::uuid
  FROM (
    SELECT overlay(
      decode(replace(gen_random_uuid()::text, '-', ''), 'hex')
      placing substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3 FOR 6)
      FROM 1 FOR 6
    ) AS b
  ) t;
$$
LANGUAGE sql
VOLATILE;

CREATE TABLE postpaid_entries (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v7(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  tx_id varchar REFERENCES transactions(id) ON DELETE RESTRICT,
  ref_tx_id varchar REFERENCES transactions(id) ON DELETE RESTRICT,
  action varchar(30) NOT NULL CHECK (action IN (
    'PURCHASE', 'REPAY_PRINCIPAL', 'REPAY_SERVICE_FEE', 'REPAY_LATE_FEE',
    'SERVICE_FEE', 'LATE_FEE', 'REFUND', 'STATEMENT_CLOSE', 'LIMIT_ADJUST'
  )),
  amount bigint NOT NULL CHECK (amount >= 0),
  delta_used bigint NOT NULL,
  used_before bigint NOT NULL CHECK (used_before >= 0),
  used_after bigint NOT NULL CHECK (used_after >= 0),
  cycle_month varchar(7),
  note text,
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_postpaid_entries_user_time ON postpaid_entries (user_id, created_at DESC);
CREATE INDEX idx_postpaid_entries_tx ON postpaid_entries (tx_id) WHERE tx_id IS NOT NULL;
CREATE INDEX idx_postpaid_entries_ref_tx ON postpaid_entries (ref_tx_id) WHERE ref_tx_id IS NOT NULL;
CREATE UNIQUE INDEX uk_postpaid_statement_cycle ON postpaid_entries (user_id, cycle_month) WHERE action = 'STATEMENT_CLOSE';
CREATE UNIQUE INDEX uk_postpaid_service_fee_cycle ON postpaid_entries (user_id, cycle_month) WHERE action = 'SERVICE_FEE';
CREATE UNIQUE INDEX uk_postpaid_late_fee_cycle ON postpaid_entries (user_id, cycle_month) WHERE action = 'LATE_FEE';
INSERT INTO users (id, role, full_name, email, phone, status, balance)
VALUES
  ('00000000-0000-7000-8000-000000000001', 'SYSTEM', 'SYSTEM_FEE_WALLET', 'system_fee_wallet@system.internal', 'SYS_FEE_01', 'ACTIVE', 0),
  ('00000000-0000-7000-8000-000000000002', 'SYSTEM', 'SYSTEM_POSTPAID_WALLET', 'system_postpaid_wallet@system.internal', 'SYS_BNPL_1', 'ACTIVE', 100000000000);
INSERT INTO system_configs (key, value, description) VALUES
  ('CONTACT_CHECK_MAX_PHONES', '500'::jsonb, 'Max phones per contact check'),
  ('DAILY_LIMIT_TIMEZONE', '"Asia/Ho_Chi_Minh"'::jsonb, 'Timezone for daily transaction limits'),
  ('EXPORT_MAX_ROWS', '50000'::jsonb, 'Max rows per Excel export'),
  ('HISTORY_PAGE_LIMIT', '20'::jsonb, 'Max items per transaction history page'),
  ('RISK_THRESHOLDS', '{"DEFAULT":{"challenge":40,"block":70},"LOGIN":{"challenge":40,"block":70},"REGISTER":{"challenge":35,"block":60},"SEND_OTP":{"challenge":30,"block":55},"OTP":{"challenge":35,"block":60},"FORGOT":{"challenge":35,"block":60},"TRANSACTION":{"challenge":35,"block":65}}'::jsonb, 'Default risk guard thresholds'),
  ('MERCHANT_FEE_CONFIG', '{"rate_bps":100,"min_fee":200,"max_fee":null,"free_threshold_amount":0,"transfer_fee_bps":0,"transfer_min_fee":0,"transfer_max_fee":null,"withdraw_fee_bps":50,"withdraw_free_quota_per_month":50000000,"monthly_plan_enabled":false,"monthly_plan_fee":0,"monthly_grace_days":7,"tiers":[{"from_amount":0,"rate_bps":100},{"from_amount":50000000,"rate_bps":80},{"from_amount":200000000,"rate_bps":60}]}'::jsonb, 'Default merchant fee config'),
  ('USER_FEE_CONFIG', '{"rate_bps":0,"min_fee":0,"max_fee":null,"free_threshold_amount":0,"transfer_fee_bps":0,"transfer_min_fee":0,"transfer_max_fee":null,"withdraw_fee_bps":0,"withdraw_free_quota_per_month":0,"tiers":[]}'::jsonb, 'Default user fee config'),
  ('POSTPAID_CONFIG', '{"enabled":true,"default_credit_limit":2000000,"min_account_days":1,"billing_day":20,"due_day":5,"late_fee_bps":200,"min_late_fee":10000,"monthly_service_fee":20000,"free_service_fee_tx_count":1}'::jsonb, 'Default postpaid wallet config'),
  ('POSTPAID_REMINDER_CONFIG', '{"enabled":true,"reminder_day":1,"reminder_hour":8,"templates":{"PAST_DUE":{"title":"Ví trả sau đang quá hạn thanh toán","body":"Ví trả sau của bạn còn dư nợ {{used_amount}} ({{overdue_detail}}). Vui lòng thanh toán để mở lại chi tiêu."},"BILLED":{"title":"Nhắc thanh toán dư nợ Ví trả sau","body":"Bạn còn dư nợ {{statement_debt}}{{cycle_part}} cần thanh toán{{due_part}}{{unbilled_part}}."},"UNBILLED":{"title":"Thông báo dư nợ Ví trả sau","body":"Ví trả sau của bạn hiện còn dư nợ {{used_amount}} chưa thanh toán. Bạn có thể thanh toán bất kỳ lúc nào trên ứng dụng."}}}'::jsonb, 'Default postpaid monthly debt reminder config'),
  ('POSTPAID_STATUS', '{"INACTIVE":"Chưa kích hoạt","ACTIVE":"Đang hoạt động","PAST_DUE":"Quá hạn thanh toán","FROZEN":"Đang tạm khóa"}'::jsonb, 'Postpaid wallet statuses'),
  ('POSTPAID_ENTRY_ACTIONS', '{"PURCHASE":"Thanh toán QR bằng Ví trả sau","REPAY_PRINCIPAL":"Trả nợ gốc Ví trả sau","REPAY_SERVICE_FEE":"Thanh toán phí dịch vụ Ví trả sau","REPAY_LATE_FEE":"Thanh toán phí trễ hạn","SERVICE_FEE":"Phí dịch vụ Ví trả sau hàng tháng","LATE_FEE":"Phí trễ hạn kỳ sao kê","REFUND":"Hoàn tiền giao dịch Ví trả sau","STATEMENT_CLOSE":"Chốt sao kê kỳ","LIMIT_ADJUST":"Điều chỉnh hạn mức"}'::jsonb, 'Postpaid entry action types'),
  ('TRANSACTION_LIMIT_CONFIG', '{"MERCHANT":{"QR_PAYMENT":{"min_amount":1000,"max_amount":50000000,"daily_limit":null},"SANDBOX_TOPUP":{"min_amount":1000,"max_amount":50000000,"daily_limit":null},"TOPUP":{"min_amount":10000,"max_amount":50000000,"daily_limit":50000000},"TRANSFER":{"min_amount":1000,"max_amount":50000000,"daily_limit":50000000},"WITHDRAW":{"min_amount":10000,"max_amount":200000000,"daily_limit":500000000}},"USER":{"QR_PAYMENT":{"min_amount":1000,"max_amount":50000000,"daily_limit":null},"SANDBOX_TOPUP":{"min_amount":1000,"max_amount":50000000,"daily_limit":null},"TOPUP":{"min_amount":10000,"max_amount":50000000,"daily_limit":50000000},"TRANSFER":{"min_amount":1000,"max_amount":50000000,"daily_limit":50000000},"WITHDRAW":{"min_amount":10000,"max_amount":30000000,"daily_limit":30000000}}}'::jsonb, 'Default system transaction limit config'),
  ('WALLET_CAPACITY_CONFIG', '{"USER":{"min_capacity":10000000,"default_capacity":100000000,"max_capacity":200000000},"MERCHANT":{"min_capacity":50000000,"default_capacity":2000000000,"max_capacity":5000000000}}'::jsonb, 'Default wallet capacity config');
