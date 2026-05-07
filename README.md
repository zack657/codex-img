# codex-img feasibility test

This is a minimal local test for an image generation queue:

1. A job is written to SQLite with a user prompt.
2. A local worker scans the database every 5 seconds.
3. The worker invokes `codex exec`, asks the generation agent only to create the image, then the worker locates the new PNG, copies it into `generated/`, updates the row, and optionally POSTs a completion callback to the server.

This intentionally does not use `OPENAI_API_KEY` or the OpenAI Images API. It relies on the local Codex CLI being logged in and on the non-interactive Codex exec environment exposing the built-in `image_gen` tool.

## Quick test

```bash
npm run db:init
npm run dev
npm run job:add -- "A tiny watercolor robot painting a sunlit window, square composition"
npm run worker:once
```

Generated images are saved under `generated/`.

Open the web app at `http://localhost:3000`.

Typical local run:

```bash
npm run dev
npm run worker
```

Reference images can be attached from the web UI. Name each image, then mention it in the prompt with `@name`, for example:

```text
参考@图片1，生成对应的图片
```

To test only the DB and worker flow without calling the API:

```bash
npm run db:init
npm run job:add -- "Dry run image prompt"
npm run worker:dry-run
```

## Worker options

```bash
node scripts/worker.js --once
node scripts/worker.js --interval-ms 5000
node scripts/worker.js --dry-run
```

Environment variables:

- `DATABASE_PATH`: optional, defaults to `data/jobs.sqlite`.
- `OUTPUT_DIR`: optional, defaults to `generated/`.
- `CODEX_BIN`: optional, defaults to `/Applications/Codex.app/Contents/Resources/codex` when present, otherwise `codex`.
- `CODEX_TIMEOUT_MS`: optional, defaults to 10 minutes.
