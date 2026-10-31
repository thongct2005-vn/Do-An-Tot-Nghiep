const { Server } = require("socket.io");
const tokenUtil = require("./jwt");

let io;
const activeSockets = new Map();

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

    socket.on("disconnect", (reason) => {
      if (activeSockets.get(userId) === socket.id) {
        activeSockets.delete(userId);
      }
    });
  });

  return io;
};

const emitToUser = (userId, eventName, data) => {
  if (io) {
    io.to(`user_${userId}`).emit(eventName, data);
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