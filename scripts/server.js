import { createReadStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, relative, resolve } from "node:path";
import { migrate, openDatabase } from "./db.js";

const port = Number(process.env.PORT || 3000);
const rootDir = process.cwd();
const publicDir = resolve(rootDir, "public");
const generatedDir = resolve(rootDir, "generated");
const uploadsDir = resolve(rootDir, "uploads");

const db = openDatabase();
migrate(db);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (request.method === "GET" && url.pathname === "/api/jobs") {
      return sendJson(response, { jobs: listJobs() });
    }

    if (request.method === "POST" && url.pathname === "/api/jobs") {
      const body = await readJson(request);
      const prompt = String(body.prompt || "").trim();
      const references = normalizeReferences(body.references || []);
      if (!prompt) return sendJson(response, { error: "Prompt is required" }, 400);
      if (prompt.length > 4000) return sendJson(response, { error: "Prompt is too long" }, 400);
      if (references.length > 6) return sendJson(response, { error: "Up to 6 reference images are supported" }, 400);

      const result = db
        .prepare("INSERT INTO image_jobs (prompt) VALUES (?)")
        .run(prompt);
      const jobId = Number(result.lastInsertRowid);
      saveReferences(jobId, references);

      return sendJson(response, { job: getJob(jobId) }, 201);
    }

    const deleteMatch = url.pathname.match(/^\/api\/jobs\/(\d+)$/);
    if (request.method === "DELETE" && deleteMatch) {
      const id = Number(deleteMatch[1]);
      const job = getJob(id);
      if (!job) return sendJson(response, { error: "Image not found" }, 404);
      if (job.status === "processing") {
        return sendJson(response, { error: "Images in progress cannot be deleted" }, 409);
      }

      removeGeneratedFiles(id, job.image_path);
      removeReferenceFiles(id);
      db.prepare("DELETE FROM image_jobs WHERE id = ?").run(id);
      return sendJson(response, { ok: true });
    }

    if ((request.method === "GET" || request.method === "HEAD") && url.pathname.startsWith("/generated/")) {
      return serveFile(request, response, generatedDir, url.pathname.replace("/generated/", ""));
    }

    if ((request.method === "GET" || request.method === "HEAD") && url.pathname.startsWith("/uploads/")) {
      return serveFile(request, response, uploadsDir, url.pathname.replace("/uploads/", ""));
    }

    if (request.method === "GET" || request.method === "HEAD") {
      const filePath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      return serveFile(request, response, publicDir, filePath);
    }

    sendJson(response, { error: "Not found" }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(response, { error: message }, 500);
  }
});

server.listen(port, () => {
  console.log(`Image studio running at http://localhost:${port}`);
});

function listJobs() {
  return db.prepare(`
    SELECT id, prompt, status, attempts, image_path, error, created_at, updated_at
    FROM image_jobs
    ORDER BY created_at DESC, id DESC
    LIMIT 80
  `).all().map(serializeJob);
}

function getJob(id) {
  const job = db.prepare(`
    SELECT id, prompt, status, attempts, image_path, error, created_at, updated_at
    FROM image_jobs
    WHERE id = ?
  `).get(id);
  return job ? serializeJob(job) : null;
}

function serializeJob(job) {
  return {
    ...job,
    image_url: imageUrl(job.image_path),
    references: listReferences(job.id)
  };
}

function listReferences(jobId) {
  return db.prepare(`
    SELECT id, name, file_path, mime_type, created_at
    FROM image_job_references
    WHERE job_id = ?
    ORDER BY id ASC
  `).all(jobId).map((reference) => ({
    id: reference.id,
    name: reference.name,
    url: uploadUrl(reference.file_path),
    mime_type: reference.mime_type,
    created_at: reference.created_at
  }));
}

function imageUrl(imagePath) {
  if (!imagePath) return null;
  const absolute = resolve(imagePath);
  const rel = relative(generatedDir, absolute);
  if (rel.startsWith("..") || rel === "") return null;
  return `/generated/${rel.split("/").map(encodeURIComponent).join("/")}`;
}

function uploadUrl(filePath) {
  if (!filePath) return null;
  const absolute = resolve(filePath);
  const rel = relative(uploadsDir, absolute);
  if (rel.startsWith("..") || rel === "") return null;
  return `/uploads/${rel.split("/").map(encodeURIComponent).join("/")}`;
}

function removeGeneratedFiles(jobId, imagePath) {
  const jobGeneratedDir = resolve(generatedDir, `job-${jobId}`);
  if (existsSync(jobGeneratedDir)) {
    rmSync(jobGeneratedDir, { recursive: true, force: true });
  }

  if (imagePath) {
    const absolute = resolve(imagePath);
    const rel = relative(generatedDir, absolute);
    if (!rel.startsWith("..") && rel !== "" && existsSync(absolute)) {
      rmSync(absolute, { force: true });
    }
  }
}

function removeReferenceFiles(jobId) {
  const jobUploadDir = resolve(uploadsDir, `job-${jobId}`);
  if (existsSync(jobUploadDir)) {
    rmSync(jobUploadDir, { recursive: true, force: true });
  }
}

function serveFile(request, response, baseDir, requestPath) {
  const cleanPath = decodeURIComponent(requestPath).replace(/^\/+/, "");
  const absolute = resolve(join(baseDir, cleanPath));
  const rel = relative(baseDir, absolute);

  if (rel.startsWith("..") || rel === "" || !existsSync(absolute) || !statSync(absolute).isFile()) {
    return sendText(response, "Not found", 404, "text/plain; charset=utf-8");
  }

  response.writeHead(200, {
    "Content-Type": mimeType(absolute),
    "Cache-Control": absolute.startsWith(generatedDir) ? "no-cache" : "public, max-age=60"
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(absolute).pipe(response);
}

function readJson(request) {
  return new Promise((resolvePromise, reject) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 60_000_000) {
        request.destroy();
        reject(new Error("Request body is too large"));
      }
    });
    request.on("end", () => {
      try {
        resolvePromise(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    request.on("error", reject);
  });
}

function normalizeReferences(value) {
  if (!Array.isArray(value)) return [];
  return value.map((reference, index) => {
    const name = String(reference.name || "").trim();
    const dataUrl = String(reference.dataUrl || "");
    if (!name) throw new Error(`Reference ${index + 1} needs a name`);
    if (name.length > 40) throw new Error(`Reference ${index + 1} name is too long`);
    if (!/^[\w\u4e00-\u9fa5 -]+$/u.test(name)) {
      throw new Error(`Reference ${index + 1} name can only use letters, numbers, Chinese characters, spaces, - and _`);
    }
    const parsed = parseImageDataUrl(dataUrl);
    return { name, ...parsed };
  });
}

function parseImageDataUrl(dataUrl) {
  const match = dataUrl.match(/^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) throw new Error("Reference images must be PNG, JPG, or WebP");
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > 8 * 1024 * 1024) throw new Error("Each reference image must be 8MB or smaller");
  return { mimeType: match[1].toLowerCase(), buffer };
}

function saveReferences(jobId, references) {
  if (!references.length) return;
  const jobUploadDir = resolve(uploadsDir, `job-${jobId}`);
  mkdirSync(jobUploadDir, { recursive: true });

  const insert = db.prepare(`
    INSERT INTO image_job_references (job_id, name, file_path, mime_type)
    VALUES (?, ?, ?, ?)
  `);

  references.forEach((reference, index) => {
    const extension = extensionForMime(reference.mimeType);
    const filePath = resolve(jobUploadDir, `${index + 1}-${safeFilePart(reference.name)}.${extension}`);
    writeFileSync(filePath, reference.buffer);
    insert.run(jobId, reference.name, filePath, reference.mimeType);
  });
}

function safeFilePart(value) {
  return value.trim().replace(/[^\w\u4e00-\u9fa5-]+/gu, "-").replace(/^-+|-+$/g, "") || "reference";
}

function extensionForMime(mimeType) {
  return mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
}

function sendJson(response, payload, status = 200) {
  sendText(response, JSON.stringify(payload), status, "application/json; charset=utf-8");
}

function sendText(response, payload, status, contentType) {
  response.writeHead(status, { "Content-Type": contentType });
  response.end(payload);
}

function mimeType(filePath) {
  const type = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml; charset=utf-8",
    ".webp": "image/webp"
  }[extname(filePath).toLowerCase()];

  return type || "application/octet-stream";
}
