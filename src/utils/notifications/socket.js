const { Server } = require("socket.io");
const tokenUtil = require("../auth/jwt");
const pool = require("../../config/database");

let io;
const activeSockets = new Map();


const TOKEN_REFRESH_GRACE_MS = 60 * 1000;

const clearExpiryTimers = (socket) => {
  clearTimeout(socket.data.expiryTimer);
  clearTimeout(socket.data.graceTimer);
};

const scheduleTokenExpiry = (socket) => {
  clearExpiryTimers(socket);
  const msLeft = Math.max(0, socket.user.exp * 1000 - Date.now());
  socket.data.expiryTimer = setTimeout(() => {
    socket.emit("token_expired", { grace_ms: TOKEN_REFRESH_GRACE_MS });
    socket.data.graceTimer = setTimeout(
      () => socket.disconnect(true),
      TOKEN_REFRESH_GRACE_MS,
    );
    socket.data.graceTimer.unref();
  }, msLeft);
  socket.data.expiryTimer.unref();
};

const initSocket = (server, corsOrigins = []) => {
  io = new Server(server, {
    cors: {
      origin: corsOrigins,
      methods: ["GET", "POST"],
    },
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      const err = new Error("Thiếu phiên đăng nhập để kết nối");
      err.statusCode = 401;
      return next(err);
    }

    try {
      const decode = tokenUtil.verifyAccessToken(token);
      if (decode.type === "USER") {
        const sessionOk = await isActiveUserSession(decode);
        if (!sessionOk) {
          const err = new Error("Phiên đăng nhập đã kết thúc");
          err.statusCode = 401;
          return next(err);
        }
      }

      socket.user = decode;
      next();
    } catch (e) {
      const message =
        e?.name === "TokenExpiredError"
          ? "Phiên đăng nhập đã hết hạn"
          : "Phiên đăng nhập không hợp lệ";
      const err = new Error(message);
      err.statusCode = 401;
      return next(err);
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.user.user_id;
    const oldSocketId = activeSockets.get(userId);
    if (oldSocketId && oldSocketId !== socket.id) {
      const oldSocket = io.sockets.sockets.get(oldSocketId);
      if (oldSocket) {
        oldSocket.emit("force_logout", {
          reason: "Tài khoản của bạn vừa được đăng nhập ở một thiết bị khác",
        });
        oldSocket.disconnect(true);
      }
    }

    activeSockets.set(userId, socket.id);
    socket.join(`user_${userId}`);
    scheduleTokenExpiry(socket);

    socket.on("refresh_auth", async (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => { };
      try {
        const decoded = tokenUtil.verifyAccessToken(payload?.token);
        if (decoded.user_id !== userId || !(await isActiveUserSession(decoded))) {
          return reply({ ok: false });
        }
        socket.user = decoded;
        scheduleTokenExpiry(socket);
        reply({ ok: true });
      } catch (e) {
        reply({ ok: false });
      }
    });

    socket.on("disconnect", (reason) => {
      clearExpiryTimers(socket);
      if (activeSockets.get(userId) === socket.id) {
        activeSockets.delete(userId);
      }
    });
  });

  return io;
};

/**
 * Kiểm tra access token còn khớp phiên refresh_token hiện tại của user trong DB hay không.
 * `users.refresh_token` lưu SHA-256 hex (64 ký tự), 16 ký tự đầu trùng với `decode.sid`.
 */
async function isActiveUserSession(decoded) {
  if (decoded?.type !== "USER") return true;
  const { rows } = await pool.query(
    "SELECT refresh_token FROM users WHERE id = $1",
    [decoded.user_id],
  );
  const currentRefresh = rows[0]?.refresh_token;
  if (!currentRefresh) return false;
  const expectedSid = /^[0-9a-f]{64}$/i.test(currentRefresh)
    ? currentRefresh.toLowerCase().slice(0, 16)
    : tokenUtil.getSessionId(currentRefresh);
  return decoded.sid === undefined || decoded.sid === expectedSid;
}

const emitToUser = (userId, eventName, data) => {
  try {
    if (io) {
      io.to(`user_${userId}`).emit(eventName, data);
    }
  } catch (e) {
    console.error(`Lỗi gửi socket "${eventName}" tới user ${userId}:`, e.message);
  }
};

const disconnectUser = (userId) => {
  if (!io) return;
  io.in(`user_${userId}`).disconnectSockets(true);
  activeSockets.delete(userId);
};

module.exports = {
  initSocket,
  emitToUser,
  disconnectUser
};