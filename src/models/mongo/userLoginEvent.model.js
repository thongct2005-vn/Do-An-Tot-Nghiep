const mongoose = require("mongoose");
const { warnMongoAudit } = require("../../utils/db/audit");

const userLoginEventSchema = new mongoose.Schema(
  {
    user_id: {
      type: String,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["SUCCESS", "FAILED"],
      default: "SUCCESS",
      index: true,
    },
    logged_in_at: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    collection: "user_login_events",
    versionKey: false,
    bufferCommands: false,
  },
);

userLoginEventSchema.index({ status: 1, logged_in_at: -1, user_id: 1 });

const UserLoginEvent =
  mongoose.models.UserLoginEvent ||
  mongoose.model("UserLoginEvent", userLoginEventSchema);

/**
 * Ghi nhận sự kiện đăng nhập Mobile App thành công vào MongoDB (fail-safe, không chặn luồng chính).
 * @param {{ userId: string | number, loggedInAt?: Date }} params
 */
async function recordSuccessfulUserLogin({ userId, loggedInAt = new Date() }) {
  if (userId === undefined || userId === null || String(userId).trim() === "") {
    return null;
  }

  try {
    if (mongoose.connection.readyState !== 1) {
      warnMongoAudit("user login skipped while disconnected");
      return null;
    }
    return await UserLoginEvent.create({
      user_id: String(userId),
      status: "SUCCESS",
      logged_in_at: loggedInAt,
    });
  } catch (err) {
    warnMongoAudit("user login write failed");
    return null;
  }
}

module.exports = {
  UserLoginEvent,
  recordSuccessfulUserLogin,
};
