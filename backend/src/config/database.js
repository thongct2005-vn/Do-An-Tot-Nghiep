const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  password: process.env.DB_PASSWORD,
  user: process.env.DB_USER,
});

pool.connect((err, client, release) => {
  if (err) {
    console.log("Lỗi kết nối database: ", err.stack);
  } else {
    console.log("Kết nối database thành công!");
    release();
  }
});

module.exports = pool;
