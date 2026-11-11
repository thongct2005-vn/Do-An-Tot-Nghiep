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
  account_number varchar, account_holder_name varchar, is_default boolean,
  status varchar, created_at timestamptz
);
CREATE TABLE admin_user_change_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admin_id uuid REFERENCES users(id), user_id uuid REFERENCES users(id),
  action varchar(60), reason text, old_values jsonb, new_values jsonb, created_at timestamptz,
  CONSTRAINT chk_admin_change_action CHECK (action IN (
    'USER_PROFILE_UPDATED', 'USER_BLOCKED', 'USER_UNBLOCKED', 'USER_LOGIN_UNLOCKED',
    'MERCHANT_BLOCKED', 'MERCHANT_UNBLOCKED',
    'USER_SESSIONS_REVOKED', 'USER_QR_REGENERATED', 'ADMIN_OP_P2P', 'ADMIN_OP_TOPUP',
    'ADMIN_OP_WITHDRAW', 'DISPUTE_OPENED', 'DISPUTE_UPDATED', 'DISPUTE_RESOLVED'
  ))
);
CREATE TABLE payment_requests (
  id uuid PRIMARY KEY, destination_user_id uuid REFERENCES users(id),
  reference_code varchar, transaction_id varchar, status varchar DEFAULT 'PENDING', created_at timestamptz DEFAULT NOW(),
  amount bigint, description varchar(50), order_id varchar, callback_url text, return_url text,
  expires_at timestamptz DEFAULT NOW() + interval '15 minutes', paid_at timestamptz,
  updated_at timestamptz DEFAULT NOW()
);
CREATE UNIQUE INDEX payment_requests_merchant_order_uk ON payment_requests(destination_user_id, order_id);
CREATE TABLE audit_outbox (
  id uuid PRIMARY KEY, event_type varchar, payload jsonb, created_at timestamptz DEFAULT NOW()
);
CREATE TABLE idempotency_keys (
  idempotency_key varchar PRIMARY KEY, actor_id uuid, actor_type varchar, request_path text, request_hash text,
  status varchar DEFAULT 'PENDING', response_body jsonb, response_status_code integer,
  create_at timestamptz DEFAULT NOW()
);
CREATE TABLE webhook_deliveries (
  id uuid PRIMARY KEY, merchant_id uuid REFERENCES users(id), last_http_status integer,
  created_at timestamptz
);
CREATE TYPE transaction_type_enum AS ENUM ('PAYMENT', 'TRANSFER', 'TOPUP', 'WITHDRAW');
CREATE TABLE transactions (
  id varchar PRIMARY KEY, destination_user_id uuid REFERENCES users(id), source_user_id uuid REFERENCES users(id),
  amount bigint, fee bigint DEFAULT 0,
  status varchar, transaction_type transaction_type_enum, created_at timestamptz
);
