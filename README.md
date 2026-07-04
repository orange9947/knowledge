# AI Learning Knowledge Graph

Local-first learning assistant for turning a keyword into Chinese learning cards, source records, and graph-ready knowledge data.

## Current State

This repository contains a runnable local Web MVP:

- FastAPI backend with SQLite persistence.
- React/Vite frontend with Learn, Graph, History, and Settings views.
- Knowledge bases, so runs and graph nodes are scoped instead of globally merged.
- Default learning sources seeded on first startup: GitHub, Juejin, Dev.to, Stack Overflow, Hacker News, and Google News RSS.
- Custom source settings for built-in sources, RSS feeds, domains, entry URLs, and search pages.
- OpenAI-compatible model settings for OpenAI, DeepSeek, or compatible gateways.
- JSON import/export without raw API keys.
- Local fallback card and graph generation when no model API key is configured.

## Setup

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -e "backend[dev]"
npm install --prefix frontend
```

## Run

Backend:

```bash
. .venv/bin/activate
cd backend
python -m uvicorn app.main:app --reload
```

Frontend:

```bash
cd frontend
npm run dev
```

The frontend runs on `http://localhost:5173` and proxies API calls to `http://localhost:8000`.

## Use

1. Open the frontend.
2. Select or create a knowledge base.
3. Enter a keyword and keep the default `light` mode for quick runs.
4. Click `Run`.
5. Review learning cards, captured sources, graph nodes, and history.

The first run works without saving source settings because the backend seeds default sources. Settings can still replace those sources with custom RSS feeds, domains, entry URLs, or search pages.

## Source Behavior

The crawler is best-effort. Some sites block scraping or require JavaScript; those sources are saved as `partial` or `failed` with a reason instead of failing the whole run. RSS entries and JSON/text responses are preserved as usable partial material when full article extraction is not available.

## API Highlights

- `POST /runs`
- `POST /runs/{run_id}/collect`
- `GET /runs/{run_id}`
- `GET /runs/{run_id}/status`
- `GET /runs/{run_id}/sources`
- `GET /runs/{run_id}/cards`
- `GET /knowledge-bases`
- `POST /knowledge-bases`
- `GET /knowledge/graph`
- `GET /knowledge/nodes/{node_id}`
- `GET /knowledge/search`
- `GET /export`
- `POST /import`

## Test

```bash
. .venv/bin/activate
cd backend
pytest
```

```bash
cd frontend
npm test -- --run
npm run build
```

## Known Limits

- Run execution is synchronous in this MVP; long deep-mode runs can hold the request open.
- Search-page crawling is experimental and depends on each site's markup and blocking behavior.
- The graph view shows a compact preview and node details, not a full force-directed graph editor.
- The fallback generator creates useful placeholder cards; configure a model API key for higher-quality synthesis.

## Documents

- Design spec: `docs/superpowers/specs/2026-07-04-ai-learning-knowledge-graph-design.md`
- Implementation plan: `docs/superpowers/plans/2026-07-04-ai-learning-knowledge-graph-implementation-plan.md`
