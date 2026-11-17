const mongoose = require("mongoose");
const { getCurrentMonthBoundsInVietnam } = require("../../utils/dateRange");

const loginStatsDailyUserSchema = new mongoose.Schema(
  {
    date_vn: { type: String, required: true },
    week_vn: { type: String, required: true },
    month_vn: { type: String, required: true },
    user_id: { type: String, required: true },
    login_count: { type: Number, required: true },
    updated_at: { type: Date, default: Date.now },
  },
  {
    collection: "login_stats_daily_users",
    versionKey: false,
    bufferCommands: false,
  },
);

loginStatsDailyUserSchema.index({ date_vn: 1, user_id: 1 }, { unique: true });
loginStatsDailyUserSchema.index({ week_vn: 1, user_id: 1 });
loginStatsDailyUserSchema.index({ month_vn: 1, user_id: 1 });

const loginStatsRollupStateSchema = new mongoose.Schema(
  {
    _id: { type: String, default: "default" },
    rollup_until_date_vn: { type: String, default: null },
    rollup_until_instant: { type: Date, default: null },
    lock_until: { type: Date, default: null },
    updated_at: { type: Date, default: Date.now },
  },
  {
    collection: "login_stats_rollup_state",
    versionKey: false,
    bufferCommands: false,
  },
);

const LoginStatsDailyUser =
  mongoose.models.LoginStatsDailyUser ||
  mongoose.model("LoginStatsDailyUser", loginStatsDailyUserSchema);

const LoginStatsRollupState =
  mongoose.models.LoginStatsRollupState ||
  mongoose.model("LoginStatsRollupState", loginStatsRollupStateSchema);

function getVnTodayBounds(now = new Date()) {
  const { endDate: todayVn } = getCurrentMonthBoundsInVietnam(now);
  const todayStartInstant = new Date(`${todayVn}T00:00:00.000+07:00`);
  return { todayVn, todayStartInstant };
}

async function ensureLoginRollupIndexes() {
  if (mongoose.connection.readyState !== 1) return;
  await LoginStatsDailyUser.createIndexes();
  await LoginStatsRollupState.createIndexes();
}

async function mergeLoginEventsWindowToDailyRollup({
  startInstant = null,
  endInstant,
}) {
  if (mongoose.connection.readyState !== 1) return;
  const { UserLoginEvent } = require("./userLoginEvent.model");

  await ensureLoginRollupIndexes();

  const loggedInFilter = startInstant
    ? { $gte: startInstant, $lt: endInstant }
    : { $lt: endInstant };

  await UserLoginEvent.collection
    .aggregate(
      [
        {
          $match: {
            status: "SUCCESS",
            logged_in_at: loggedInFilter,
          },
        },
        {
          $group: {
            _id: {
              date_vn: {
                $dateToString: {
                  format: "%Y-%m-%d",
                  date: "$logged_in_at",
                  timezone: "Asia/Ho_Chi_Minh",
                },
              },
              user_id: "$user_id",
            },
            login_count: { $sum: 1 },
            week_vn: {
              $first: {
                $dateToString: {
                  format: "%Y-%m-%d",
                  date: {
                    $dateTrunc: {
                      date: "$logged_in_at",
                      unit: "week",
                      startOfWeek: "monday",
                      timezone: "Asia/Ho_Chi_Minh",
                    },
                  },
                  timezone: "Asia/Ho_Chi_Minh",
                },
              },
            },
            month_vn: {
              $first: {
                $dateToString: {
                  format: "%Y-%m",
                  date: "$logged_in_at",
                  timezone: "Asia/Ho_Chi_Minh",
                },
              },
            },
          },
        },
        {
          $project: {
            _id: 0,
            date_vn: "$_id.date_vn",
            week_vn: 1,
            month_vn: 1,
            user_id: "$_id.user_id",
            login_count: 1,
            updated_at: "$$NOW",
          },
        },
        {
          $merge: {
            into: "login_stats_daily_users",
            on: ["date_vn", "user_id"],
            whenMatched: "replace",
            whenNotMatched: "insert",
          },
        },
      ],
      { allowDiskUse: true },
    )
    .toArray();
}

/**
 * Backfill toàn bộ các ngày Việt Nam đã khép (< 00:00 hôm nay GMT+7) sang login_stats_daily_users.
 */
async function backfillLoginStatsDailyUsers({ now = new Date() } = {}) {
  if (mongoose.connection.readyState !== 1) {
    throw new Error("MongoDB is not connected");
  }
  const { todayVn, todayStartInstant } = getVnTodayBounds(now);
  await ensureLoginRollupIndexes();

  await LoginStatsDailyUser.collection.deleteMany({});
  await mergeLoginEventsWindowToDailyRollup({
    startInstant: null,
    endInstant: todayStartInstant,
  });

  await LoginStatsRollupState.collection.updateOne(
    { _id: "default" },
    {
      $set: {
        rollup_until_date_vn: todayVn,
        rollup_until_instant: todayStartInstant,
        lock_until: null,
        updated_at: new Date(),
      },
    },
    { upsert: true },
  );

  const count = await LoginStatsDailyUser.collection.countDocuments({});
  return {
    rollupUntilDateVn: todayVn,
    rollupUntilInstant: todayStartInstant,
    dailyUserDocs: count,
  };
}

/**
 * Chốt thêm các ngày đã khép mới phát sinh sau mốc rollup_until_date_vn.
 * Tự động bỏ qua an toàn nếu MongoDB chưa kết nối hoặc chưa khởi tạo state backfill.
 */
async function advanceLoginRollupCutoff({ now = new Date() } = {}) {
  if (mongoose.connection.readyState !== 1) {
    return { skippedDisconnected: true };
  }

  const state = await LoginStatsRollupState.collection.findOne({ _id: "default" });
  if (!state || !state.rollup_until_date_vn || !state.rollup_until_instant) {
    return { skippedNotInitialized: true, rollupUntilInstant: null };
  }

  const { todayVn, todayStartInstant } = getVnTodayBounds(now);
  if (state.rollup_until_date_vn >= todayVn) {
    return {
      advanced: false,
      rollupUntilDateVn: state.rollup_until_date_vn,
      rollupUntilInstant: new Date(state.rollup_until_instant),
    };
  }

  const leaseRes = await LoginStatsRollupState.collection.findOneAndUpdate(
    {
      _id: "default",
      $or: [{ lock_until: null }, { lock_until: { $lt: now } }],
    },
    {
      $set: {
        lock_until: new Date(now.getTime() + 60000),
        updated_at: now,
      },
    },
    { returnDocument: "after" },
  );
  const leased = leaseRes?.value ?? leaseRes;
  if (!leased) {
    const fresh = await LoginStatsRollupState.collection.findOne({ _id: "default" });
    return {
      advanced: false,
      lockedByPeer: true,
      rollupUntilDateVn: fresh?.rollup_until_date_vn || state.rollup_until_date_vn,
      rollupUntilInstant: fresh?.rollup_until_instant
        ? new Date(fresh.rollup_until_instant)
        : new Date(state.rollup_until_instant),
    };
  }

  try {
    const mergeStart = new Date(`${state.rollup_until_date_vn}T00:00:00.000+07:00`);
    await mergeLoginEventsWindowToDailyRollup({
      startInstant: mergeStart,
      endInstant: todayStartInstant,
    });

    await LoginStatsRollupState.collection.updateOne(
      { _id: "default" },
      {
        $set: {
          rollup_until_date_vn: todayVn,
          rollup_until_instant: todayStartInstant,
          lock_until: null,
          updated_at: new Date(),
        },
      },
    );

    return {
      advanced: true,
      rollupUntilDateVn: todayVn,
      rollupUntilInstant: todayStartInstant,
    };
  } catch (err) {
    await LoginStatsRollupState.collection
      .updateOne({ _id: "default" }, { $set: { lock_until: null } })
      .catch(() => {});
    throw err;
  }
}

module.exports = {
  LoginStatsDailyUser,
  LoginStatsRollupState,
  getVnTodayBounds,
  ensureLoginRollupIndexes,
  mergeLoginEventsWindowToDailyRollup,
  backfillLoginStatsDailyUsers,
  advanceLoginRollupCutoff,
};
