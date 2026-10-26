const pool = require("../../config/database");

const kycRepository = {
  async checkIdExists(idNumber) {
    const result = await pool.query(`SELECT id FROM user_kyc WHERE id = $1`, [
      idNumber,
    ]);
    return { is_exists: result.rows.length > 0 };
  },

  async checkUserKYC(userId) {
    const result = await pool.query(
      `SELECT user_id FROM user_kyc WHERE user_id = $1 AND status = 'APPROVED' LIMIT 1`,
      [userId],
    );
    return { is_kyc: result.rows.length > 0 };
  },

  async findApprovedKycByUserId(userId) {
    const result = await pool.query(
      `SELECT id, front_image_url, face_image_url
       FROM user_kyc
       WHERE user_id = $1 AND status = 'APPROVED'
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId],
    );
    return result.rows[0] ?? null;
  },

  async saveKYCResult({
    idNumber,
    userId,
    fullName,
    dob,
    gender,
    address,
    frontImageUrl,
    backImageUrl,
    faceImageUrl,
    status,
    matchScore,
  }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `INSERT INTO user_kyc (
            id, user_id, dob, gender, address,
            front_image_url, back_image_url, face_image_url, status, face_match_score
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id, user_id, dob, gender, address`,
        [
          idNumber,
          userId,
          dob,
          gender,
          address,
          frontImageUrl,
          backImageUrl,
          faceImageUrl,
          status,
          matchScore,
        ],
      );
      await client.query(`UPDATE users SET full_name = $1 WHERE id = $2`, [
        fullName,
        userId,
      ]);
      await client.query("COMMIT");
      return result;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  },

  async updateFaceImage({ userId, faceImageUrl }) {
    await pool.query(
      `UPDATE user_kyc SET face_image_url = $1 WHERE user_id = $2`,
      [faceImageUrl, userId],
    );
  },
};

module.exports = kycRepository;