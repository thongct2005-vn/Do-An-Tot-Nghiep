const { Server } = require("socket.io");
const tokenUtil = require("./jwt");

let io;
const activeSockets = new Map();

// Access token chỉ được kiểm tra lúc handshake nên trước đây socket vẫn sống sau khi token hết hạn.
// Giờ khi token hết hạn server báo "token_expired" và cho client TOKEN_REFRESH_GRACE_MS để gửi
// token mới qua sự kiện "refresh_auth"; quá hạn mà chưa gia hạn thì ngắt kết nối.
const TOKEN_REFRESH_GRACE_MS = 60 * 1000;
const MAX_TIMER_MS = 2 ** 31 - 1;

const clearExpiryTimers = (socket) => {
  clearTimeout(socket.data.expiryTimer);
  clearTimeout(socket.data.graceTimer);
};

const scheduleTokenExpiry = (socket) => {
  clearExpiryTimers(socket);
  const msLeft = Math.min(
    Math.max(0, socket.user.exp * 1000 - Date.now()),
    MAX_TIMER_MS,
  );
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

  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      const err = new Error("Thiếu thông tin xác thực để kết nối");
      err.statusCode = 401;
      return next(err);
    }

    try {
      const decode = tokenUtil.verifyAccessToken(token);
      socket.user = decode;
      next();
    } catch (e) {
      const err = new Error("Thông tin xác thực không hợp lệ hoặc đã hết hạn");
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

    socket.on("refresh_auth", (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => { };
      try {
        const decoded = tokenUtil.verifyAccessToken(payload?.token);
        if (decoded.user_id !== userId) {
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
  io.in(`user_${userId}`).disconnectSockets(true); // cần socket.io v4
  activeSockets.delete(userId);
};

module.exports = {
  initSocket,
  emitToUser,
  disconnectUser
};