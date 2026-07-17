const { Pool } = require('pg')
require('dotenv').config();

const pool = new Pool ({
    connectionString: process.env.DATABASE_URL,
    ssl:{
        rejectUnauthorized: false
    }
});

pool.connect((err, client, release) => {
    if(err){
        console.log("Lỗi kết nối database: ",err.stack);
    }
    
    else{
        console.log("Kết nối database thành công!");
        release();
    }
});

module.exports = pool