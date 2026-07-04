# AI Learning Knowledge Graph

Local-first learning assistant for turning a keyword into Chinese learning cards, source records, and graph-ready knowledge data.

## Current State

This repository currently contains the runnable project skeleton:

- FastAPI backend with health check and core SQLite models.
- React/Vite frontend shell with backend health status.
- Backend repository tests for the first persistence slice.

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

## Documents

- Design spec: `docs/superpowers/specs/2026-07-04-ai-learning-knowledge-graph-design.md`
- Implementation plan: `docs/superpowers/plans/2026-07-04-ai-learning-knowledge-graph-implementation-plan.md`
