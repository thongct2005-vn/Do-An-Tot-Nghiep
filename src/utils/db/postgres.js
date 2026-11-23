// postgres.js: Các tiện ích SQL, khóa dòng an toàn, chiếm giữ email và xử lý lỗi PostgreSQL dùng chung cho nhiều repository.
const crypto = require("node:crypto");
const { httpError } = require("../common/http");

function isMissingRelationError(err) {
  return err?.code === "42P01";
}

function makeParamAdder(params) {
  return (value) => {
    params.push(value);
    return `$${params.length}`;
  };
}

function vnDateStartBoundSql(paramPlaceholder) {
  return `((${paramPlaceholder}::date::timestamp) AT TIME ZONE 'Asia/Ho_Chi_Minh')`;
}

function vnDateEndExclusiveBoundSql(paramPlaceholder) {
  return `(((${paramPlaceholder}::date + 1)::timestamp) AT TIME ZONE 'Asia/Ho_Chi_Minh')`;
}

function displayNameSql(alias = "u") {
  return `COALESCE(NULLIF(TRIM(${alias}.full_name), ''), ${alias}.phone, 'Người dùng')`;
}

function maskPhoneSql(expr) {
  return `CASE WHEN LENGTH(COALESCE(${expr}, '')) >= 7 THEN LEFT(${expr}, 3) || '****' || RIGHT(${expr}, 3) ELSE ${expr} END`;
}

/**
 * Khóa các bản ghi trong bảng users theo thứ tự UUID tăng dần để tránh deadlock.
 */
async function lockUsersOrderedTx(
  client,
  userIds,
  { selectColumns = "id, balance, role, status" } = {},
) {
  const uniqueIds = [
    ...new Set((userIds || []).filter(Boolean).map((id) => String(id))),
  ].sort();
  if (uniqueIds.length === 0) return new Map();

  const res = await client.query(
    `SELECT ${selectColumns}
       FROM users
      WHERE id = ANY($1::uuid[])
      ORDER BY id ASC
      FOR UPDATE`,
    [uniqueIds],
  );

  const byId = new Map();
  for (const row of res.rows) {
    byId.set(String(row.id), row);
  }
  return byId;
}

/**
 * Khóa và lấy liên kết ngân hàng đang hoạt động thuộc về người dùng trong transaction.
 */
async function lockActiveLinkedBankTx(
  client,
  {
    bankId,
    userId,
    selectColumns = "*",
    notFoundMessage = "Không tìm thấy ngân hàng liên kết hợp lệ",
  },
) {
  const res = await client.query(
    `SELECT ${selectColumns}
       FROM linked_banks
      WHERE id = $1
        AND user_id = $2
        AND is_active = true
      FOR UPDATE`,
    [bankId, userId],
  );
  if (!res.rows[0]) {
    throw httpError(404, notFoundMessage);
  }
  return res.rows[0];
}

// Tất cả các luồng ghi/cập nhật users.email bắt buộc phải gọi hàm này bên trong transaction (READ COMMITTED),
// trước khi khóa dòng người dùng mục tiêu. Khóa này sẽ tồn tại cho đến khi COMMIT hoặc ROLLBACK.
async function claimEmail(client, email, userId = null) {
  if (email === undefined || email === null) return email;
  const normalized = email.trim().toLowerCase();

  // Cho phép thao tác gỡ bỏ/xóa trống email của hồ sơ người dùng
  if (!normalized) return normalized;

  // Băm chuỗi định danh email thành số nguyên 64-bit (bigint) để làm khóa advisory lock
  const lockKey = crypto
    .createHash("sha256")
    .update(`users.email:${normalized}`)
    .digest()
    .readBigInt64BE(0)
    .toString();

  // Khóa độc quyền theo địa chỉ email trong transaction hiện tại để chống race condition
  await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [lockKey]);

  // Kiểm tra trùng lặp email với các tài khoản khác sau khi đã giữ khóa
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

module.exports = {
  isMissingRelationError,
  makeParamAdder,
  vnDateStartBoundSql,
  vnDateEndExclusiveBoundSql,
  displayNameSql,
  maskPhoneSql,
  lockUsersOrderedTx,
  lockActiveLinkedBankTx,
  claimEmail,
};

