const { verify } = require('crypto');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const ACCESS_SECRET = process.env.ACCESS_SECRET;
const REFRESH_SECRET = process.env.REFRESH_SECRET;

const tokenUtil = {
  generateAuthTokens(user) {
    const payload = {
      user_id: user.id,
      phone: user.phone,
      full_name: user.full_name,
      wallet_id: user.wallet_id,
      type: user.role
    };

    const accessToken = jwt.sign(payload, ACCESS_SECRET, { expiresIn: '15m' });
    const refreshToken = jwt.sign(payload, REFRESH_SECRET, { expiresIn: '7d' });
    return {
      accessToken,
      refreshToken,
    };
  },

  verifyAccessToken(accessToken) {
    return jwt.verify(accessToken, ACCESS_SECRET);
  },

  verifyRefreshToken(refreshToken) {
    return jwt.verify(refreshToken, REFRESH_SECRET);
  },
};
module.exports = tokenUtil;
