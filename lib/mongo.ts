import mongoose from "mongoose";

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/cold_chain_monitoring";

const globalForMongo = globalThis as unknown as {
  mongoConnectionPromise?: Promise<mongoose.Connection>;
};

/**
 * Returns the native MongoDB database for the monitoring store.
 * Callers share a single in-flight connection promise so concurrent route
 * handlers cannot start two connections and observe an undefined database.
 */
export async function getMongoDb() {
  if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
    return mongoose.connection.db;
  }

  if (!globalForMongo.mongoConnectionPromise) {
    globalForMongo.mongoConnectionPromise = mongoose
      .connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
      .then(() => mongoose.connection)
      .catch((error) => {
        globalForMongo.mongoConnectionPromise = undefined;
        throw error;
      });
  }

  const connection = await globalForMongo.mongoConnectionPromise;
  if (!connection.db) {
    throw new Error("MongoDB connection has no database");
  }
  return connection.db;
}
