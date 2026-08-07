const { initializeApp, cert } = require("firebase-admin/app");
require("dotenv").config();

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

const firebaseApp = initializeApp({
  credential: cert(serviceAccount),
});

module.exports = firebaseApp;