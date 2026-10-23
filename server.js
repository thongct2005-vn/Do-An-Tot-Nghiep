const express = require("express");
const http = require("http");
const path = require("path");
const app = express();
const errorHandler = require("./src/middlewares/errorHandler");
require("dotenv").config();
const router = require("./src/routes/index");
const { initSocket } = require("./src/utils/socket");
const server = http.createServer(app);
const cors = require("cors");
app.use(cors());
const PORT = process.env.PORT;
initSocket(server);
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

app.set("trust proxy", 1);
app.use(errorHandler);

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
server.listen(PORT, () => {
  console.log(`Server running ${PORT}`);
});
module.exports = app;