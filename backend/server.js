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
app.set("trust proxy", 1);
app.use(errorHandler);
app.use("/images", express.static(path.join(__dirname, "images")));
server.listen(PORT, () => {
  console.log(`Server running ${PORT}`);
});
module.exports = app;
