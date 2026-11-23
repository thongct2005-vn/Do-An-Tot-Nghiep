// authRepositoryBase.js: Nhóm hàm truy vấn DB dùng chung cho các Auth repository (lockout, refresh token, TOTP).
const pool = require("../../config/database");
const tokenUtil = require("./jwt");

function createLoginLockoutMethods({
  db = pool,
  table = "users",
  identifierCol = "phone",
  roleFilterSql = "",
} = {}) {
  const roleClause = roleFilterSql ? ` AND ${roleFilterSql}` : "";
  return {
    async resetFailedLogin(identifier) {
      await db.query(
        `UPDATE ${table}
            SET failed_login_attempts = 0,
                locked_until = NULL
          WHERE ${identifierCol} = $1${roleClause}`,
        [identifier],
      );
    },

    async registerFailedLogin(args) {
      const identifier =
        typeof args === "object" && args !== null
          ? args[identifierCol] ?? args.identifier ?? args.phone ?? args.email
          : args;
      const { maxAttempts, lockMinutes } = args || {};
      const result = await db.query(
        `UPDATE ${table}
            SET failed_login_attempts = COALESCE(failed_login_attempts, 0) + 1,
                locked_until = CASE
                  WHEN COALESCE(failed_login_attempts, 0) + 1 >= $2::INT
                  THEN NOW() + ($3::TEXT || ' minutes')::INTERVAL
                  ELSE locked_until
                END
          WHERE ${identifierCol} = $1${roleClause}
          RETURNING failed_login_attempts`,
        [identifier, maxAttempts, lockMinutes],
      );
      return result.rows[0];
    },
  };
}

function createRefreshTokenMethods({
  db = pool,
  table = "users",
  hashRefresh = true,
  roleFilterSql = "",
  clearFcmOnLogout = false,
} = {}) {
  const roleClause = roleFilterSql ? ` AND ${roleFilterSql}` : "";
  const formatToken = (t) => (hashRefresh ? tokenUtil.hashToken(t) : t);

  const updateFn = async ({ refreshToken, userId }) => {
    await db.query(
      `UPDATE ${table} SET refresh_token = $1 WHERE id = $2${roleClause}`,
      [formatToken(refreshToken), userId],
    );
  };

  return {
    updateRefeshToken: updateFn,
    updateRefreshToken: updateFn,

    async logout(userId, refreshToken) {
      if (refreshToken !== undefined) {
        await db.query(
          `UPDATE ${table}
              SET refresh_token = NULL
            WHERE id = $1 AND refresh_token = $2${roleClause}`,
          [userId, formatToken(refreshToken)],
        );
        return;
      }
      if (clearFcmOnLogout) {
        await db.query(
          `UPDATE ${table} SET refresh_token = $1, fcm_token = $2 WHERE id = $3${roleClause}`,
          [null, null, userId],
        );
        return;
      }
      await db.query(
        `UPDATE ${table} SET refresh_token = NULL WHERE id = $1${roleClause}`,
        [userId],
      );
    },
  };
}

function createTotpRepositoryMethods(db = pool, { table = "users" } = {}) {
  return {
    async getTotpState(userId) {
      const result = await db.query(
        `SELECT totp_secret, totp_enabled, totp_last_step,
                (totp_locked_until > NOW()) AS is_totp_locked
           FROM ${table}
          WHERE id = $1`,
        [userId],
      );
      return result.rows[0] ?? null;
    },

    async saveTotpSecret({ userId, encryptedSecret }) {
      const result = await db.query(
        `UPDATE ${table}
            SET totp_secret = $1,
                totp_enabled = false,
                totp_last_step = NULL,
                totp_failed_attempts = 0,
                totp_locked_until = NULL
          WHERE id = $2 AND totp_enabled = false
          RETURNING id`,
        [encryptedSecret, userId],
      );
      return result.rows[0] ?? null;
    },

    async enableTotp(userId) {
      const result = await db.query(
        `UPDATE ${table}
            SET totp_enabled = true
          WHERE id = $1 AND totp_enabled = false AND totp_secret IS NOT NULL
          RETURNING id`,
        [userId],
      );
      return result.rows[0] ?? null;
    },

    async disableTotp(userId) {
      await db.query(
        `UPDATE ${table}
            SET totp_enabled = false,
                totp_secret = NULL,
                totp_last_step = NULL,
                totp_failed_attempts = 0,
                totp_locked_until = NULL
          WHERE id = $1`,
        [userId],
      );
    },

    async consumeTotpStep({ userId, step }) {
      const result = await db.query(
        `UPDATE ${table}
            SET totp_last_step = $2,
                totp_failed_attempts = 0,
                totp_locked_until = NULL
          WHERE id = $1 AND (totp_last_step IS NULL OR totp_last_step < $2)
          RETURNING id`,
        [userId, step],
      );
      return result.rowCount === 1;
    },

    async registerTotpFailure({ userId, maxAttempts, lockMinutes }) {
      const result = await db.query(
        `UPDATE ${table}
            SET totp_failed_attempts = n.attempts,
                totp_locked_until = CASE
                  WHEN n.attempts >= $2::INT
                  THEN NOW() + ($3::TEXT || ' minutes')::INTERVAL
                  ELSE NULL
                END
          FROM (
            SELECT id,
                   CASE
                     WHEN totp_locked_until IS NOT NULL AND totp_locked_until <= NOW() THEN 1
                     ELSE COALESCE(totp_failed_attempts, 0) + 1
                   END AS attempts
              FROM ${table}
             WHERE id = $1
          ) n
          WHERE ${table}.id = n.id
          RETURNING ${table}.totp_failed_attempts`,
        [userId, maxAttempts, lockMinutes],
      );
      return result.rows[0];
    },
  };
}

module.exports = {
  createLoginLockoutMethods,
  createRefreshTokenMethods,
  createTotpRepositoryMethods,
};
