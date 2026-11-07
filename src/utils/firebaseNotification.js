const { getMessaging } = require("firebase-admin/messaging");
const firebaseApp = require("../config/firebase");
const userRepository = require("../modules/user/user.repository");

const sendPushNotification = async (userId, { title, body, data = {} }) => {
  try {
    const user = await userRepository.getFcmToken(userId);
    const { fcm_token: fcmToken, full_name: fullName } = user;
    if (!fcmToken) {
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
  } catch (e) {
    console.error(`Lỗi gửi FCM tới user ${fullName} - ${userId}:`, e.message);

    // Token ko hợp lệ hoặc sai định dạng
    if (
      e.code === "messaging/registration-token-not-registered" ||
      e.code === "messaging/invalid-registration-token"
    ) {
      await userRepository.updateFcmToken(userId, null);
      console.log(`Đã xóa fcm_token không hợp lệ của user ${fullName} - ${userId}`);
    }
  }
};

module.exports = { sendPushNotification };