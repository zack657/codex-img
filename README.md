# codex-img feasibility test

[中文文档](README.zh-CN.md)

A minimal local image-generation queue for testing whether `codex exec` can drive the built-in image generation tool from a worker process.

## What it does

1. Stores image jobs in a local SQLite database.
2. Serves a small web UI for prompts, reference images, queue status, and results.
3. Runs a worker that picks queued jobs, calls `codex exec`, and asks Codex to generate exactly one image.
4. Copies the generated image into `generated/`, updates the job row, and optionally sends a completion callback.

This project intentionally does not use `OPENAI_API_KEY` or the OpenAI Images API. It relies on the local Codex CLI being logged in and on the non-interactive Codex exec environment exposing the built-in `image_gen` tool.

## Requirements

- Node.js 24 or newer
- Codex CLI available locally
- A logged-in Codex environment that can use the built-in `image_gen` tool

## Quick Start

```bash
npm run db:init
npm run dev
npm run job:add -- "A tiny watercolor robot painting a sunlit window, square composition"
npm run worker:once
```

Open the web app at:

```text
http://localhost:3000
```

Generated images are saved under `generated/`.

## Typical Local Run

Run the web server:

```bash
npm run dev
```

Run the worker in another terminal:

```bash
npm run worker
```

## Reference Images

Reference images can be attached from the web UI. Name each image, then mention it in the prompt with `@name`.

Example:

```text
Use @product as the subject and render it as a clean studio product photo.
```

The web UI supports PNG, JPG, and WebP reference images up to 8 MB each.

## Dry Run

To test only the database and worker flow without calling Codex image generation:

```bash
npm run db:init
npm run job:add -- "Dry run image prompt"
npm run worker:dry-run
```

## Worker Options

```bash
node scripts/worker.js --once
node scripts/worker.js --interval-ms 5000
node scripts/worker.js --dry-run
```

## Environment Variables

- `DATABASE_PATH`: optional, defaults to `data/jobs.sqlite`.
- `OUTPUT_DIR`: optional, defaults to `generated/`.
- `CODEX_BIN`: optional, defaults to `/Applications/Codex.app/Contents/Resources/codex` when present, otherwise `codex`.
- `CODEX_TIMEOUT_MS`: optional, defaults to 10 minutes.
- `MAX_ATTEMPTS`: optional, defaults to `3`.

## Local-Only Data

The following paths are intentionally ignored by git:

- `data/`
- `generated/`
- `uploads/`
- `codex-exec-test/`
- `.env*`

Do not commit local databases, generated images, uploaded reference images, or secrets.
