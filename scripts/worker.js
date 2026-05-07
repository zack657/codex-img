import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { migrate, openDatabase } from "./db.js";

const options = parseArgs(process.argv.slice(2));
const outputDir = resolve(process.env.OUTPUT_DIR || "generated");
const codexBin = process.env.CODEX_BIN || defaultCodexBin();
const codexTimeoutMs = Number(process.env.CODEX_TIMEOUT_MS || 10 * 60 * 1000);
const maxAttempts = Number(process.env.MAX_ATTEMPTS || 3);

mkdirSync(outputDir, { recursive: true });

const db = openDatabase();
migrate(db);

try {
  if (options.once) {
    console.log(`Using Codex CLI: ${codexBin}`);
    const didWork = await tick();
    if (!didWork) console.log("No queued jobs found.");
  } else {
    console.log(`Using Codex CLI: ${codexBin}`);
    console.log(`Worker running. Scanning every ${options.intervalMs}ms.`);
    while (true) {
      await tick();
      await sleep(options.intervalMs);
    }
  }
} finally {
  if (options.once) db.close();
}

async function tick() {
  const job = claimNextJob();
  if (!job) return false;

  console.log(`Processing job ${job.id}: ${job.prompt}`);

  try {
    const imagePath = options.dryRun
      ? writeDryRunImage(job)
      : await generateImage(job);

    db.prepare(`
      UPDATE image_jobs
      SET status = 'done', image_path = ?, error = NULL, locked_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(imagePath, job.id);

    await notifySafely(job, { status: "done", imagePath });
    console.log(`Job ${job.id} done: ${imagePath}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const nextStatus = job.attempts + 1 >= maxAttempts ? "failed" : "queued";

    db.prepare(`
      UPDATE image_jobs
      SET status = ?, error = ?, locked_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(nextStatus, message, job.id);

    await notifySafely(job, { status: nextStatus, error: message });
    console.error(`Job ${job.id} ${nextStatus}: ${message}`);
  }

  return true;
}

function claimNextJob() {
  db.exec("BEGIN IMMEDIATE");
  try {
    const job = db.prepare(`
      SELECT id, prompt, callback_url, attempts
      FROM image_jobs
      WHERE status = 'queued' AND attempts < ?
      ORDER BY created_at ASC, id ASC
      LIMIT 1
    `).get(maxAttempts);

    if (!job) {
      db.exec("COMMIT");
      return null;
    }

    db.prepare(`
      UPDATE image_jobs
      SET status = 'processing',
          attempts = attempts + 1,
          locked_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(job.id);

    db.exec("COMMIT");
    return job;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

async function generateImage(job) {
  const jobDir = resolve(outputDir, `job-${job.id}`);
  const imagePath = resolve(jobDir, "image.png");
  const finalMessagePath = resolve(jobDir, "codex-final.txt");
  const references = getReferences(job.id);
  const startedAt = Date.now();

  mkdirSync(jobDir, { recursive: true });

  const prompt = [
    "Generate exactly one image with the built-in image generation tool.",
    "Do not inspect the filesystem, do not run shell commands, do not search for files, and do not copy or verify output files.",
    "Do not use any external image API, curl, or a placeholder.",
    "The worker has already attached every reference image and will locate, copy, and verify the generated PNG after you finish.",
    references.length
      ? `Reference mapping: ${references.map((reference, index) => `@${reference.name} = attached image ${index + 1}`).join("; ")}`
      : "No reference images are attached to this request.",
    references.length
      ? "When the user prompt mentions an @name, use the matching attached reference image for subject, style, layout, identity, or visual details as requested."
      : "",
    `User image prompt: ${job.prompt}`,
    "After the image is generated, respond with only: IMAGE_GENERATED"
  ].filter(Boolean).join("\n");

  const result = await runCodexExec(prompt, finalMessagePath, references);
  const generatedImagePath = findGeneratedImage(result, startedAt);
  if (!generatedImagePath) {
    throw new Error(`Codex exec completed but the worker could not find a new generated PNG. Output: ${result.slice(-2000)}`);
  }

  cpSync(generatedImagePath, imagePath);
  const stats = statSync(imagePath);
  if (!stats.isFile() || stats.size === 0) throw new Error(`Generated PNG copy is empty: ${imagePath}`);

  return imagePath;
}

function getReferences(jobId) {
  return db.prepare(`
    SELECT name, file_path, mime_type
    FROM image_job_references
    WHERE job_id = ?
    ORDER BY id ASC
  `).all(jobId);
}

function runCodexExec(prompt, finalMessagePath, references = []) {
  mkdirSync(dirname(finalMessagePath), { recursive: true });
  const imageArgs = references.flatMap((reference) => ["--image", reference.file_path]);

  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      codexBin,
      [
        "exec",
        "--skip-git-repo-check",
        "--dangerously-bypass-approvals-and-sandbox",
        "-C",
        process.cwd(),
        ...imageArgs,
        "--output-last-message",
        finalMessagePath,
        prompt
      ],
      {
        cwd: process.cwd(),
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );

    let output = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`codex exec timed out after ${codexTimeoutMs}ms`));
    }, codexTimeoutMs);

    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
      process.stderr.write(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise(output);
      else reject(new Error(`codex exec exited with code ${code}. Output: ${output.slice(-2000)}`));
    });
  });
}

function findGeneratedImage(codexOutput, startedAt) {
  const root = codexGeneratedImagesDir();
  const sessionId = codexOutput.match(/session id:\s*([a-z0-9-]+)/i)?.[1];
  const roots = sessionId ? [resolve(root, sessionId), root] : [root];

  for (const searchRoot of roots) {
    const candidates = collectPngs(searchRoot)
      .filter((candidate) => candidate.mtimeMs >= startedAt - 2000)
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    if (candidates[0]) return candidates[0].path;
  }

  return null;
}

function collectPngs(root) {
  if (!existsSync(root)) return [];
  const entries = [];
  for (const dirent of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, dirent.name);
    if (dirent.isDirectory()) {
      entries.push(...collectPngs(path));
    } else if (dirent.isFile() && dirent.name.toLowerCase().endsWith(".png")) {
      const stats = statSync(path);
      if (stats.size > 0) entries.push({ path, mtimeMs: stats.mtimeMs });
    }
  }
  return entries;
}

function codexGeneratedImagesDir() {
  return resolve(process.env.CODEX_HOME || resolve(homedir(), ".codex"), "generated_images");
}

function writeDryRunImage(job) {
  const filename = `job-${job.id}-${Date.now()}-dry-run.svg`;
  const imagePath = resolve(outputDir, filename);
  const escapedPrompt = escapeXml(job.prompt);

  writeFileSync(
    imagePath,
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="#f5f1e8"/>
  <rect x="96" y="96" width="832" height="832" rx="28" fill="#ffffff" stroke="#1f2937" stroke-width="8"/>
  <text x="512" y="462" text-anchor="middle" font-family="Arial, sans-serif" font-size="42" fill="#111827">dry run image job</text>
  <text x="512" y="540" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" fill="#374151">${escapedPrompt.slice(0, 90)}</text>
</svg>`
  );

  return imagePath;
}

async function notify(job, payload) {
  if (!job.callback_url) return;

  const response = await fetch(job.callback_url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId: job.id, ...payload })
  });

  if (!response.ok) {
    throw new Error(`callback ${basename(job.callback_url)} failed: ${response.status} ${response.statusText}`);
  }
}

async function notifySafely(job, payload) {
  try {
    await notify(job, payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.prepare(`
      UPDATE image_jobs
      SET error = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(`notification failed: ${message}`, job.id);
    console.error(`Job ${job.id} notification failed: ${message}`);
  }
}

function parseArgs(args) {
  const intervalIndex = args.indexOf("--interval-ms");
  const intervalMs = intervalIndex === -1 ? 5000 : Number(args[intervalIndex + 1]);

  return {
    once: args.includes("--once"),
    dryRun: args.includes("--dry-run"),
    intervalMs: Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 5000
  };
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function defaultCodexBin() {
  const appBundleBin = "/Applications/Codex.app/Contents/Resources/codex";
  return existsSync(appBundleBin) ? appBundleBin : "codex";
}
