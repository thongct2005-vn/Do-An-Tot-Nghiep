const mongoose = require("mongoose");

const INITIAL_RETRY_MS = 1000;
const MAX_RETRY_MS = 30000;
let retryDelay = INITIAL_RETRY_MS;
let retryTimer = null;
let connectInFlight = null;
let stopping = false;
let listenersAttached = false;

function scheduleRetry() {
  if (stopping || retryTimer || !process.env.MONGODB_URI) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void connectMongo();
  }, retryDelay);
  retryTimer.unref?.();
  retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS);
}

function attachListeners() {
  if (listenersAttached) return;
  listenersAttached = true;
  mongoose.connection.on("connected", () => {
    retryDelay = INITIAL_RETRY_MS;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    console.info(`MongoDB connected: ${mongoose.connection.name}`);
  });
  mongoose.connection.on("disconnected", () => {
    if (stopping) return;
    console.warn("MongoDB disconnected; audit temporarily unavailable");
    scheduleRetry();
  });
  mongoose.connection.on("error", (err) => {
    console.warn(`MongoDB connection warning: ${err?.name || "Error"}`);
  });
}

async function connectMongo() {
  if (stopping) return false;
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.warn("MONGODB_URI is missing; MongoDB audit is unavailable");
    return false;
  }
  if (mongoose.connection.readyState === 1) return true;
  if (connectInFlight) return connectInFlight;
  attachListeners();
  connectInFlight = (async () => {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000, bufferCommands: false });
      return true;
    } catch (err) {
      console.warn(`MongoDB connection failed: ${err?.name || "Error"}`);
      scheduleRetry();
      return false;
    } finally {
      connectInFlight = null;
    }
  })();
  return connectInFlight;
}

async function stopMongo() {
  stopping = true;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  if (connectInFlight) await connectInFlight;
  await mongoose.disconnect();
}

module.exports = connectMongo;
module.exports.stopMongo = stopMongo;
