const express = require("express");
const http = require("http");
const app = express();
const errorHandler = require("./src/middlewares/errorHandler");
require("dotenv").config();
const router = require("./src/routes/index");
const { initSocket } = require("./src/utils/socket");
const server = http.createServer(app);
const PORT = process.env.PORT;
initSocket(server);
app.use(express.json());
app.use("/api/v2", router);

app.use(errorHandler);

server.listen(PORT, () => {
  console.log(`Server running ${PORT}`);
});
module.exports = app;
