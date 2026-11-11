const crypto = require("node:crypto");
const { httpError } = require("./httpError");

// All users.email writers must call this inside their READ COMMITTED transaction,
// before acquiring target-user row locks. The lock lasts until COMMIT/ROLLBACK.
async function claimEmail(client, email, userId = null) {
  if (email === undefined || email === null) return email;
  const normalized = email.trim().toLowerCase();
  // Preserve the existing USER profile's explicit clear-email operation.
  if (!normalized) return normalized;
  const lockKey = crypto.createHash("sha256")
    .update(`users.email:${normalized}`).digest().readBigInt64BE(0).toString();
  await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [lockKey]);
  const conflict = await client.query(
    `SELECT id FROM users WHERE LOWER(BTRIM(email)) = $1
       AND ($2::uuid IS NULL OR id <> $2::uuid) LIMIT 1`,
    [normalized, userId],
  );
  if (conflict.rowCount) {
    throw httpError(409, "Địa chỉ email đã được liên kết với tài khoản khác");
  }
  return normalized;
}

module.exports = { claimEmail };
