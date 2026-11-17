const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const mongoose = require("mongoose");
const { UserLoginEvent } = require("../src/models/mongo/userLoginEvent.model");
const {
  LoginStatsDailyUser,
  backfillLoginStatsDailyUsers,
} = require("../src/models/mongo/loginStatsDailyUser.model");

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is required");
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000, bufferCommands: false });
  try {
    const res = await backfillLoginStatsDailyUsers();
    console.log("Login stats backfill complete:", res);

    const indexes = await LoginStatsDailyUser.collection.indexes();
    const hasUnique = indexes.some(
      (idx) =>
        idx.unique === true &&
        idx.key?.date_vn === 1 &&
        idx.key?.user_id === 1,
    );
    if (!hasUnique) {
      throw new Error(`Missing unique {date_vn:1, user_id:1} index: ${JSON.stringify(indexes)}`);
    }
    console.log("Verified unique index { date_vn: 1, user_id: 1 } on login_stats_daily_users.");

    // Parity verification against user_login_events (< rollupUntilInstant)
    const rawAgg = await UserLoginEvent.collection
      .aggregate(
        [
          {
            $match: {
              status: "SUCCESS",
              logged_in_at: { $lt: res.rollupUntilInstant },
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
              cnt: { $sum: 1 },
            },
          },
          {
            $facet: {
              days: [
                {
                  $group: {
                    _id: "$_id.date_vn",
                    total_logins: { $sum: "$cnt" },
                    unique_users: { $sum: 1 },
                  },
                },
                { $sort: { _id: 1 } },
              ],
              summary: [
                { $group: { _id: "$_id.user_id", cnt: { $sum: "$cnt" } } },
                {
                  $group: {
                    _id: null,
                    total_logins: { $sum: "$cnt" },
                    unique_users: { $sum: 1 },
                  },
                },
              ],
            },
          },
        ],
        { allowDiskUse: true },
      )
      .toArray();

    const rollupAgg = await LoginStatsDailyUser.collection
      .aggregate(
        [
          {
            $match: {
              date_vn: { $lt: res.rollupUntilDateVn },
            },
          },
          {
            $facet: {
              days: [
                {
                  $group: {
                    _id: "$date_vn",
                    total_logins: { $sum: "$login_count" },
                    unique_users: { $sum: 1 },
                  },
                },
                { $sort: { _id: 1 } },
              ],
              summary: [
                { $group: { _id: "$user_id", cnt: { $sum: "$login_count" } } },
                {
                  $group: {
                    _id: null,
                    total_logins: { $sum: "$cnt" },
                    unique_users: { $sum: 1 },
                  },
                },
              ],
            },
          },
        ],
        { allowDiskUse: true },
      )
      .toArray();

    const rawFacet = rawAgg[0] || { days: [], summary: [] };
    const rollupFacet = rollupAgg[0] || { days: [], summary: [] };
    if (JSON.stringify(rawFacet.days) !== JSON.stringify(rollupFacet.days)) {
      throw new Error(`Day-level parity mismatch: raw=${JSON.stringify(rawFacet.days)} rollup=${JSON.stringify(rollupFacet.days)}`);
    }
    if (JSON.stringify(rawFacet.summary) !== JSON.stringify(rollupFacet.summary)) {
      throw new Error(`Summary parity mismatch: raw=${JSON.stringify(rawFacet.summary)} rollup=${JSON.stringify(rollupFacet.summary)}`);
    }
    console.log("MongoDB login_stats_daily_users parity check PASSED (0 discrepancy)!", rawFacet.summary[0] || { total_logins: 0, unique_users: 0 });
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error("Login stats backfill failed:", err);
  process.exit(1);
});
