const { getMessaging } = require("firebase-admin/messaging");
const firebaseApp = require("../config/firebase");
const userRepository = require("../modules/user/user.repository");

const sendPushNotification = async (userId, { title, body, data = {} }) => {
  try {
    const fcmToken = await userRepository.getFcmToken(userId);
    if (!fcmToken) {
      console.log(`User ${userId} chưa có fcm_token, bỏ qua gửi noti`);
      return;
    }

    const stringData = Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, String(v)]),
    );

    await getMessaging(firebaseApp).send({
      token: fcmToken,
      notification: { title, body },
      data: stringData,
      android: {
        priority: "high",
        notification: { channelId: "wallet_channel" },
      },
      apns: {
        payload: { aps: { sound: "default" } },
      },
    });

    console.log(`Đã gửi push notification tới user ${userId}`);
  } catch (e) {
    console.error(`Lỗi gửi FCM tới user ${userId}:`, e.message);

    if (
      e.code === "messaging/registration-token-not-registered" ||
      e.code === "messaging/invalid-registration-token"
    ) {
      try {
        await userRepository.updateFcmToken(userId, null);
        console.log(`Đã xóa fcm_token không hợp lệ của user ${userId}`);
      } catch (cleanupErr) {
        console.error(`Không xóa được fcm_token của user ${userId}:`, cleanupErr.message);
      }
    }
  }
};

module.exports = { sendPushNotification };