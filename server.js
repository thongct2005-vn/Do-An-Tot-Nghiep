const express = require("express");
const http = require("http");
const path = require("path");
require("dotenv").config();
const helmet = require("helmet");
const cors = require("cors");
const app = express();
const errorHandler = require("./src/middlewares/errorHandler");
const router = require("./src/routes/index");
const { initSocket } = require("./src/utils/socket");
const server = http.createServer(app);
const PORT = process.env.PORT;

// Phía trước server là proxy (ngrok, nginx...) nên tin 1 lớp proxy để lấy đúng IP người dùng
app.set("trust proxy", 1);

// Thêm các header bảo mật; cho phép web ở origin khác tải ảnh logo từ server
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

// Chỉ các web này được gọi API từ trình duyệt. Khai báo thêm trong .env:
// CORS_ORIGINS=https://dashboard.tenmien.com,http://localhost:8080
// (App Flutter và Postman không gửi header Origin nên không bị CORS chặn)
const allowedOrigins = (
  process.env.CORS_ORIGINS
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) =>
      callback(null, !origin || allowedOrigins.includes(origin)),
  }),
);

initSocket(server, allowedOrigins);
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf.toString("utf8");
    },
  }),
);
app.use("/api/v2", router);

app.use(
  "/images/avatar",
  express.static(path.join(__dirname, "images", "avatar")),
);
app.use(
  "/images/bank-logo",
  express.static(path.join(__dirname, "images", "bank-logo")),
);

app.get("/api/v2/merchant/sandbox/download-apk", (req, res) => {
  const filePath = path.join(__dirname, "app_test_apk", "app-release.apk");
  res.download(filePath, "e-wallet-test.apk", (err) => {
    if (err) {
      res
        .status(404)
        .json({ message: "Không tìm thấy file APK trên hệ thống" });
    }
  });
});
app.use(errorHandler);

server.listen(PORT, () => {
  console.log(`Server running ${PORT}`);
});
module.exports = app;