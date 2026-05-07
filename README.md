# codex-img feasibility test

English | [中文](#中文)

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

---

## 中文

一个最小化的本地图像生成队列，用来验证 worker 进程是否可以通过 `codex exec` 调用内置图像生成工具。

## 功能

1. 将图像任务写入本地 SQLite 数据库。
2. 提供一个简单 Web UI，用于提交 prompt、上传参考图、查看队列状态和结果。
3. worker 会领取排队任务，调用 `codex exec`，并要求 Codex 只生成一张图。
4. worker 会把生成结果复制到 `generated/`，更新任务状态，并可选地发送完成回调。

本项目刻意不使用 `OPENAI_API_KEY`，也不调用 OpenAI Images API。它依赖本地 Codex CLI 已登录，并且非交互式 `codex exec` 环境可以使用内置的 `image_gen` 工具。

## 环境要求

- Node.js 24 或更新版本
- 本地可用的 Codex CLI
- 已登录、并且可以使用内置 `image_gen` 工具的 Codex 环境

## 快速开始

```bash
npm run db:init
npm run dev
npm run job:add -- "A tiny watercolor robot painting a sunlit window, square composition"
npm run worker:once
```

打开 Web 应用：

```text
http://localhost:3000
```

生成图片会保存到 `generated/`。

## 常规本地运行

启动 Web 服务：

```bash
npm run dev
```

在另一个终端启动 worker：

```bash
npm run worker
```

## 参考图

可以在 Web UI 上传参考图。给每张图命名后，在 prompt 中用 `@name` 引用。

示例：

```text
参考@产品图，生成一张干净的棚拍商品图
```

Web UI 支持 PNG、JPG 和 WebP 参考图，每张最大 8 MB。

## 干运行

如果只想测试数据库和 worker 流程，不实际调用 Codex 图像生成：

```bash
npm run db:init
npm run job:add -- "Dry run image prompt"
npm run worker:dry-run
```

## Worker 参数

```bash
node scripts/worker.js --once
node scripts/worker.js --interval-ms 5000
node scripts/worker.js --dry-run
```

## 环境变量

- `DATABASE_PATH`：可选，默认 `data/jobs.sqlite`。
- `OUTPUT_DIR`：可选，默认 `generated/`。
- `CODEX_BIN`：可选，如果存在则默认 `/Applications/Codex.app/Contents/Resources/codex`，否则默认 `codex`。
- `CODEX_TIMEOUT_MS`：可选，默认 10 分钟。
- `MAX_ATTEMPTS`：可选，默认 `3`。

## 仅保留在本地的数据

以下路径会被 git 忽略：

- `data/`
- `generated/`
- `uploads/`
- `codex-exec-test/`
- `.env*`

不要提交本地数据库、生成图片、上传的参考图或任何密钥。
