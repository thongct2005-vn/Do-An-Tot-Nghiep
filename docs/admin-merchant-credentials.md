# Admin Merchant credentials

All endpoints below use `/api/v2/admin/merchants/:id`, require an active ADMIN account, valid access token and current Admin session, and return `Cache-Control: no-store`. `:id` must be a Merchant UUID.

| Method | Suffix | Behavior |
| --- | --- | --- |
| GET | `/credentials` | Safe metadata: merchant_id, state, revision (decimal string), api_key_masked |
| POST | `/credentials/issue` | UNCONFIGURED → ACTIVE |
| POST | `/credentials/rotate` | ACTIVE → ACTIVE with new credentials/revision |
| POST | `/credentials/revoke` | ACTIVE → REVOKED; retain the encrypted signing secret |
| POST | `/credentials/reissue` | REVOKED → ACTIVE with new credentials/revision |
| GET | `/audit-logs?page=1&limit=10&action=MERCHANT_CREDENTIALS_REVOKED` | Credential audit events, newest first; optional action filter, limit 1–100 |

Mutation JSON (use the revision returned by GET):

```json
{"expected_revision":"1","reason":"Thay khóa theo yêu cầu đối tác"}
```

Reason is trimmed and must contain 5–500 characters. Unknown fields are rejected. A successful mutation returns the normal API envelope with metadata and `cancelled_payments`; issue/rotate/reissue additionally return `secret_key` exactly in that response. Revoke never returns a secret. All Admin responses keep API keys masked. Read endpoints and audit never return plaintext or encrypted Secret Key material.

The Web Admin result dialog shows the new Secret Key once. Closing it or leaving the Credentials view removes the value and overlay. It is not saved to client storage/cache. Lost responses must be resolved by refreshing metadata; clients must not retry blindly or attempt to retrieve an old secret. A replacement with the new revision is required if the secret was not retained by the operator. Use a secure organizational handoff channel to the Merchant.

## Payment behavior

- Revoke and replacement cancel pending payment requests in the same transaction as the credential change and audit. Customers are told to ask the shop for a new order. The Merchant queries the cancelled order with current credentials and creates a new order_id and QR after switching to V2.
- Existing SUCCESS/PAID payments and balances remain intact. There is no new cancellation webhook event.
- All PENDING webhook deliveries block replacement, including future retries and actively leased rows. Return 409 until those obligations finish. Revoke remains possible and preserves the secret required to deliver existing work.
- Old terminal payment results remain readable. Their Return URLs are not signed with the new secret when credential revisions differ. Cancelled orders never produce a signed redirect.
- User rows are locked in sorted ID order before payment rows. Creation rechecks credential revision and revocation inside the transaction. Expiry/enqueue and active Merchant self-service reset follow the same serialization protocol.
- Account blocking retains its existing admission semantics: signed requests admitted before account blocking may finish. Credential revocation and replacement are always rechecked under lock.

## Errors and operations

- 400: malformed UUID/body/reason/revision/pagination.
- 401: absent, invalid or expired login token/current session.
- 403: missing ADMIN role, inactive ADMIN, or revoked Merchant authentication/reset.
- 404: Merchant not found.
- 409: stale revision, invalid lifecycle transition, incomplete legacy key pair or outstanding webhook work. Refresh metadata before choosing another action.
- Audit insertion or another database write failure rolls back credential changes and pending-order cancellation together.

For a stuck webhook, inspect the existing worker, destination endpoint and retry state. Restore callback delivery and let the existing retry policy reach a terminal outcome; do not mark deliveries successful or force replacement solely to bypass the gate. This release does not implement emergency replacement with historical signing keys.

## Migration and rollback

Initial implementation inspected the configured application database read-only. On 2026-11-14, after explicit user approval, `backend/migrations/20261114_merchant_credentials.sql` was applied successfully to the database configured by `backend/.env`; revision backfill, audit actions and the credentials/history read handlers were verified. This does not establish migration status for other environments. Before deploying backend code to another database, apply required prior migrations (including Merchant status audit support) through the normal database release process, then the credentials migration.

The migration preserves existing revocation flags, adds revision tracking, snapshots the current revision on legacy Merchant payment requests and extends the existing audit constraint without removing its other allowed actions. `payment_requests.status` is already varchar without a restrictive CHECK in the inspected database, so CANCELLED needs no enum conversion. Verify schema differences for every target environment, including Sandbox.

Roll back by disabling new mutation endpoints/UI while retaining revocation enforcement and additive columns. Do not restore revoked credentials, reactivate cancelled orders, or delete audit records. Deploying the old backend unchanged would bypass revocation checks and is not a safe rollback.

## Verification

Backend tests use `NODE_ENV=test` and the guarded `createTestDatabase` helper, which creates and cleans a distinct `merchant_test_*` database. Application data is not modified.

```powershell
$env:NODE_ENV='test'
$env:MERCHANT_INTEGRATION_TEST='1'
node --test tests/admin_merchant_credentials.test.js tests/admin_merchant_credentials_migration.test.js tests/merchant_cancelled_qr.test.js tests/admin_merchants_integration.test.js tests/admin_merchants_profile.test.js tests/admin_merchant_block_unlock.test.js tests/merchant_blocked_access.test.js
```

From `web-admin`:

```powershell
flutter test --no-pub test/merchant_credentials_test.dart test/merchant_ui_test.dart test/merchant_status_update_test.dart test/merchant_api_service_test.dart test/merchant_status_model_test.dart
flutter analyze --no-pub lib/features/merchant
```
