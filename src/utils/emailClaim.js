const crypto = require("node:crypto");
const { httpError } = require("./httpError");

// Tất cả các luồng ghi/cập nhật users.email bắt buộc phải gọi hàm này bên trong transaction (READ COMMITTED),
// trước khi khóa dòng người dùng mục tiêu. Khóa này sẽ tồn tại cho đến khi COMMIT hoặc ROLLBACK.
async function claimEmail(client, email, userId = null) {
  if (email === undefined || email === null) return email;
  const normalized = email.trim().toLowerCase();

  // Cho phép thao tác gỡ bỏ/xóa trống email của hồ sơ người dùng
  if (!normalized) return normalized;

  // Băm chuỗi định danh email thành số nguyên 64-bit (bigint) để làm khóa advisory lock
  const lockKey = crypto.createHash("sha256")
    .update(`users.email:${normalized}`).digest().readBigInt64BE(0).toString();

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

module.exports = { claimEmail };
