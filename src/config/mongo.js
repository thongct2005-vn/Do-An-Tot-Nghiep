const mongoose = require('mongoose');
async function connectMongo() {
  try {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      console.warn('MONGODB_URI chưa được cấu hình, audit log sẽ tạm tắt');
      return;
    }
    await mongoose.connect(uri);
    console.log('Đã kết nối MongoDB (ewallet_audit_db) thành công!');
  } catch (err) {
    console.error('Lỗi kết nối MongoDB:', err.message);
  }
}
module.exports = connectMongo;