const { httpError } = require("./httpError");

/**
 * Kiểm tra một bản ghi trong bảng users có đúng ví hệ thống, đúng role và đang ACTIVE hay không.
 */
function assertValidSystemWalletRow(
  wallet,
  {
    expectedRole = "SYSTEM",
    expectedFullName = null,
    expectedPhone = null,
    activeStatus = "ACTIVE",
    displayLabel = "ví hệ thống",
    inactiveMessage = null,
  } = {},
) {
  if (!wallet) {
    throw httpError(500, `Không tìm thấy ${displayLabel} trong hệ thống`);
  }
  if (wallet.role !== expectedRole) {
    throw httpError(
      500,
      `Ví được cấu hình làm ${displayLabel} không đúng vai trò ví hệ thống`,
    );
  }
  if (
    (expectedFullName && wallet.full_name !== expectedFullName) ||
    (expectedPhone && wallet.phone !== expectedPhone)
  ) {
    throw httpError(500, `Ví được cấu hình không đúng ${displayLabel}`);
  }
  if (wallet.status !== activeStatus) {
    throw httpError(
      500,
      inactiveMessage || `${displayLabel} chưa sẵn sàng hoặc đang bị khóa`,
    );
  }
  return wallet;
}

/**
 * Truy vấn DB để kiểm tra ví hệ thống theo walletId có tồn tại, đúng role/danh tính và không trùng ví khác.
 */
async function verifySystemWalletInDb(
  db,
  {
    walletId,
    otherSystemWalletId = "",
    collisionMessage = "Hai ví hệ thống không được trùng ID",
    spec = {},
  },
) {
  const cleanId = String(walletId || "").trim();
  const otherId = String(otherSystemWalletId || "").trim();
  if (otherId && otherId === cleanId) {
    throw httpError(500, collisionMessage);
  }

  const res = await db.query(
    `SELECT id, role, status, full_name, phone
       FROM users
      WHERE id = $1
      LIMIT 1`,
    [cleanId],
  );
  const wallet = assertValidSystemWalletRow(res.rows[0], spec);
  return { walletId: cleanId, wallet };
}

module.exports = {
  assertValidSystemWalletRow,
  verifySystemWalletInDb,
};

