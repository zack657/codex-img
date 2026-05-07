import { databasePath, migrate, openDatabase } from "./db.js";

const args = process.argv.slice(2);
const callbackIndex = args.indexOf("--callback-url");
let callbackUrl = null;

if (callbackIndex !== -1) {
  callbackUrl = args[callbackIndex + 1];
  args.splice(callbackIndex, 2);
}

const prompt = args.join(" ").trim();

if (!prompt) {
  console.error('Usage: npm run job:add -- "your image prompt" [--callback-url http://localhost:3000/api/image-jobs/callback]');
  process.exit(1);
}

const db = openDatabase();
migrate(db);

const result = db
  .prepare("INSERT INTO image_jobs (prompt, callback_url) VALUES (?, ?)")
  .run(prompt, callbackUrl);

db.close();

console.log(`Queued image job ${result.lastInsertRowid} in ${databasePath}`);
