const pool = require('../../../config/database');
const { httpError } = require('../../../utils/httpError');
const { encryptSecretKey } = require('../../../utils/hashSecretKey');
const { generateUniqueMerchantApiKey, generateUniqueMerchantSecretKey } = require('../../../utils/generateApikeySecretkey');

function state(row) {
  if (Boolean(row.api_key) !== Boolean(row.secret_key)) throw httpError(409, 'Cấu hình khóa không đầy đủ, cần kiểm tra dữ liệu Merchant');
  if (!row.api_key) return 'UNCONFIGURED';
  return row.credentials_revoked ? 'REVOKED' : 'ACTIVE';
}
function metadata(row) {
  return { merchant_id: row.id, state: state(row), revision: String(row.credentials_revision),
    api_key_masked: row.api_key ? `${row.api_key.slice(0, 3)}••••${row.api_key.slice(-4)}` : null };
}
async function lockMerchant(db, id) {
  const row = (await db.query("SELECT id,role,status,api_key,secret_key,credentials_revoked,credentials_revision FROM users WHERE id=$1 AND role='MERCHANT' FOR UPDATE", [id])).rows[0];
  if (!row) throw httpError(404, 'Không tìm thấy Merchant');
  return row;
}
async function assertNoWebhook(db, id) {
  const result = await db.query("SELECT 1 FROM webhook_deliveries WHERE merchant_id=$1 AND status='PENDING' LIMIT 1", [id]);
  if (result.rowCount) throw httpError(409, 'Webhook cũ còn chờ xử lý. Vui lòng thử cấp lại sau khi hoàn tất.');
}
async function cancelPending(db, id) {
  const result = await db.query("UPDATE payment_requests SET status='CANCELLED',updated_at=now() WHERE destination_user_id=$1 AND status='PENDING'", [id]);
  return result.rowCount;
}
async function assertCurrent(row, revision) {
  // Account status was checked by authentication. Preserve admitted-before-block
  // behavior; revocation/replacement is rechecked under the credential row lock.
  if (row.credentials_revoked) throw httpError(403, 'Credentials Merchant đã thu hồi. Vui lòng cập nhật credentials.');
  if (revision == null || String(row.credentials_revision) !== String(revision)) throw httpError(409, 'Credentials đã thay đổi. Vui lòng dùng khóa mới và tạo đơn mới.');
}
async function mutate({ merchantId, operation, expectedRevision, adminId, reason, selfService = false, apiKey, secretKey }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = await lockMerchant(client, merchantId);
    const before = metadata(row);
    if (String(row.credentials_revision) !== String(expectedRevision)) throw httpError(409, 'Thông tin khóa đã thay đổi. Vui lòng tải lại.');
    if (selfService && (row.status !== 'ACTIVE' || before.state !== 'ACTIVE')) throw httpError(403, 'Không thể tự cấp lại khóa đã thu hồi hoặc tài khoản bị khóa');
    const required = { issue:'UNCONFIGURED', rotate:'ACTIVE', revoke:'ACTIVE', reissue:'REVOKED', reset_api:'ACTIVE', reset_secret:'ACTIVE' }[operation];
    if (!required || before.state !== required) throw httpError(409, 'Thao tác không phù hợp trạng thái khóa hiện tại');
    if (operation !== 'revoke') await assertNoWebhook(client, merchantId);
    const cancelled = await cancelPending(client, merchantId);
    let updated;
    let revealed;
    if (operation === 'revoke') {
      updated = (await client.query('UPDATE users SET credentials_revoked=true,updated_at=now() WHERE id=$1 RETURNING *',[merchantId])).rows[0];
    } else {
      const nextApi = operation === 'reset_secret' ? row.api_key : apiKey || await generateUniqueMerchantApiKey();
      revealed = operation === 'reset_api' ? undefined : secretKey || await generateUniqueMerchantSecretKey();
      const storedSecret = revealed ? encryptSecretKey(revealed) : row.secret_key;
      updated = (await client.query('UPDATE users SET api_key=$2,secret_key=$3,credentials_revoked=false,credentials_revision=credentials_revision+1,updated_at=now() WHERE id=$1 RETURNING *',[merchantId,nextApi,storedSecret])).rows[0];
    }
    const after = metadata(updated);
    if (!selfService) {
      const action = {issue:'ISSUED',rotate:'ROTATED',revoke:'REVOKED',reissue:'REISSUED'}[operation];
      await client.query('INSERT INTO admin_user_change_history(admin_id,user_id,action,reason,old_values,new_values,created_at) VALUES ($1,$2,$3,$4,$5,$6,now())',
        [adminId,merchantId,`MERCHANT_CREDENTIALS_${action}`,reason,JSON.stringify(before),JSON.stringify({...after,cancelled_payments:cancelled})]);
    }
    await client.query('COMMIT');
    if (selfService) return { rows: [operation === 'reset_api' ? {api_key:updated.api_key} : {secret_key:revealed}] };
    return {...after,cancelled_payments:cancelled,...(revealed ? {secret_key:revealed} : {})};
  } catch(error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
module.exports = { state, metadata, lockMerchant, assertNoWebhook, cancelPending, assertCurrent, mutate };
