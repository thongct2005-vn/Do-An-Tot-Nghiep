# ADMIN Merchant status API (GĐ3.2)

## Database inspection

Inspected the database configured by backend `.env` on 2026-11-11 inside `BEGIN READ ONLY`; `SHOW transaction_read_only` returned `on`, and the transaction ended with `ROLLBACK`. Only aggregate status counts and CHECK constraint definitions were read; no business rows were modified.

- Merchant statuses: 2 ACTIVE accounts; no legacy SUSPENDED values found.
- `users` has no status CHECK constraint.
- `admin_user_change_history.chk_admin_change_action` permits the existing USER/ADMIN_OP/DISPUTE actions, but not MERCHANT_BLOCKED or MERCHANT_UNBLOCKED.
- Its other CHECK constraints validate nonempty reason and JSON object payloads.
- No migration runner or existing SQL migration directory was found in the backend. This change supplies a standalone versioned SQL migration under `migrations/`.

The audit action migration is required before deploying the new endpoint to this database. The application does not run DDL automatically; this apply session prepares and tests the migration on isolated databases only.

## Payment admission inventory

`src/routes/index.js` is mounted under `/api/v2` in production and `/sb/api/v2` in sandbox. A search of all payment request INSERTs and repository call sites found two creation implementations:

| Entry point | Authentication / current status | Required change |
| --- | --- | --- |
| POST `/api/v2/merchant/payments` | `verifyMerchant` verifies the signed request and current MERCHANT/ACTIVE database row before idempotency or insertion | Retain guard; exercise real route and database in tests |
| POST `/sb/api/v2/merchant/sandbox/payments` (sandbox deployment) | Same route factory and signed status guard | Same verification, using sandbox factory |
| POST `/api/v2/payment/qr/dynamic` | JWT only; creation does not check current status (the existing service checks status when resolving QR, not creating it) | Add active-Merchant guard for MERCHANT callers; retain existing USER flow |

GET `/merchant/payments/:orderId` and its sandbox equivalent already use `verifyMerchant`. Static QR creation changes a token on `users` rather than inserting a payment request; QR resolve endpoints read existing requests. Payment-page and transaction handlers settle existing requests and are not new-payment creation entry points.

## Contract

`PATCH /api/v2/admin/merchants/:id/status` requires a valid ADMIN access token and current active ADMIN session. Send JSON containing only:

```json
{"status":"BLOCKED","expected_status":"ACTIVE","reason":"Phát hiện giao dịch bất thường cần kiểm tra"}
```

To unblock, swap the two status values. Both accept only exact `ACTIVE` or `BLOCKED`; `expected_status` is required. Reason is trimmed and must contain 5–500 Unicode characters. A valid request returns the standard success envelope with `data.merchant` (`id`, `status`, `updated_at`) and `data.audit` (`id`, `action`, `reason`, `created_at`).

Errors: 400 invalid UUID/body/state/reason; 401 invalid token or ended/replaced ADMIN session; 403 wrong role or blocked ADMIN; 404 missing/non-Merchant account; 409 stale expectation or duplicate target status; 500 transactional failure. Error status handling follows the existing ADMIN session middleware.

The database transaction locks the Merchant row, checks the expectation, changes the status and inserts the audit atomically. On block it clears the refresh token. Unblock preserves the cleared token, login protection, FCM token and all credential/financial data. Legacy stored states such as SUSPENDED receive 409; this API never silently converts them to ACTIVE. Existing GET APIs keep their SUSPENDED presentation mapping for BLOCKED.

## Dashboard and refresh access

All four shared Dashboard routes (info, callback, reset-apikey, reset-secretkey) now load the current account role/status after JWT and role verification. Missing accounts, a changed role, or any non-ACTIVE state return 403 before the controller runs. The shared factory applies to production and sandbox. This is an admission check; it does not introduce persistent revocation of previously issued access JWTs after the account is unblocked.

Production refresh already compares the stored refresh-token hash and requires an ACTIVE MERCHANT. Integration tests exercise its real cookie middleware, controller, service and database: refresh succeeds while active, then fails with 401 after blocking and still fails after unblocking because the cleared refresh session is not restored.

The block service emits `force_logout` only after the status and audit commit. Socket delivery is best-effort; it does not determine whether the HTTP mutation succeeded.

## Payment behavior verified

JWT dynamic QR creation now invokes the active-Merchant guard for MERCHANT tokens; the existing USER flow is retained. Signed production/sandbox payment creation already checks current status and needs no guard change. Tests cover creation while active, 403 after blocking, and creation again after unblocking with credentials still present. Signed lookup also continues to reject blocked accounts.

An integration test pauses a real payment operation after authentication but before insertion, commits an ADMIN block, then resumes the operation and verifies that its normal insert completes. Separate tests snapshot completed payments, transactions, pending webhook delivery records and account data across block/unblock; those values are preserved. The current credential storage has no versioned revocation lifecycle: the TC12 fixture clears the key pair independently and proves unblock does not recreate it or reauthorize its old API key. Versioned credential revocation remains the later credentials feature.

## Verification and rollout

Run from `backend` in PowerShell:

```powershell
$env:NODE_ENV='test'
$env:MERCHANT_INTEGRATION_TEST='1'
node --test tests/admin_merchant_status_migration.test.js tests/admin_merchant_block_unlock.test.js tests/merchant_blocked_access.test.js tests/admin_merchants_query.test.js tests/admin_merchants_integration.test.js tests/admin_merchants_profile.test.js
```

The implementation run passed 43 tests, including 18 new integration tests. The opt-in legacy `admin_merchants_status.test.js` suite was also discovered in the regression command but not enabled with `MERCHANT_STATUS_SQL_TEST`; it is not included in the 43 executed tests. No production data is used as test fixtures. Each integration suite creates a new `merchant_test_*` database from the isolated schema, verifies its identity, then drops only the database it created. Connection coordinates come from `.env`, but application queries run against the temporary database with test signing keys. The maintenance connection uses `postgres` only for creating/dropping that test database.

| Required case | Evidence |
| --- | --- |
| TC01 block ACTIVE | HTTP 200, BLOCKED row, refresh cleared, MERCHANT_BLOCKED audit |
| TC02 unblock BLOCKED | HTTP 200, ACTIVE row, MERCHANT_UNBLOCKED audit, login protection retained |
| TC03 block already BLOCKED | 409, row/audit unchanged |
| TC04 unblock already ACTIVE | 409, row/audit unchanged |
| TC05 unauthorized caller | Actual JWT/ADMIN session middleware returns 401/403 |
| TC06 invalid reason/input | 400 for types, bounds, missing expectation, unsupported states and protected fields |
| TC07 new payment after block | Real signed production/sandbox routes return 403; JWT QR path also returns 403 |
| TC08 old JWT | All four Dashboard routes return 403 after an ADMIN block |
| TC09 concurrency/stale screen | Two ADMIN requests yield exactly one 200, one 409 and one audit |
| TC10 audit failure | Real database trigger raises on INSERT; status, refresh and timestamp roll back |
| TC11 credential reset while blocked | Both Dashboard reset routes return 403 and keys remain unchanged |
| TC12 independently missing/revoked pair | Unblock retains missing keys; old API key remains unauthorized |

Additional coverage checks safe response fields, post-commit socket emission/failure, refresh cookies, in-flight payments, and migration repeatability/preservation of pre-existing action values.

Before enabling the endpoint against the inspected application database, run `migrations/20261111_merchant_status_audit_actions.sql` against the intended database using the deployment's PostgreSQL tooling, with stop-on-error enabled. The migration has been tested but was not applied to the application database in this implementation session. Back up the constraint definition before deployment. The script extends the existing CHECK atomically and is safe to rerun; no user state or audit records are rewritten. Deploy the endpoint and Dashboard guard together. Flutter status-modal integration is the subsequent GĐ3.3 change.
