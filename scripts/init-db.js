import { databasePath, migrate, openDatabase } from "./db.js";

const db = openDatabase();
migrate(db);
db.close();

console.log(`Initialized database at ${databasePath}`);
