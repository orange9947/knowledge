# AI Learning Knowledge Graph Implementation Plan

Date: 2026-07-04

Related spec: `docs/superpowers/specs/2026-07-04-ai-learning-knowledge-graph-design.md`

## Objective

Implement the local Web MVP described in the design spec. The MVP should let a user configure an OpenAI-compatible model and learning sources, enter a keyword, collect and extract related materials, generate Chinese learning cards and a knowledge graph, persist results into a local knowledge base, and export or import that knowledge base as JSON.

## Implementation Principles

- Build the backend and frontend as separate units with a clear HTTP API boundary.
- Keep the first version local-first and single-user.
- Prefer stable source discovery paths over unrestricted crawling.
- Make every long-running operation observable from the UI.
- Treat source failures and AI formatting failures as recoverable.
- Keep data models explicit and migration-friendly.
- Do not store raw API keys in exported knowledge data.

## Proposed Tech Stack

### Backend

- Python 3.11+
- FastAPI for the local HTTP API
- Pydantic for request, response, and AI-output schemas
- SQLAlchemy or SQLModel for SQLite persistence
- Alembic for database migrations if SQLAlchemy is used
- httpx for HTTP fetching
- trafilatura or readability-lxml for article extraction
- feedparser for RSS
- pytest for tests

### Frontend

- React
- TypeScript
- Vite
- TanStack Query for API state
- React Flow or Cytoscape.js for the graph view
- Vitest and React Testing Library for frontend tests

### Local Configuration

- YAML or JSON config file for source and advanced crawler settings
- Local settings API for common model and source configuration
- API key storage outside exported knowledge JSON

## Milestones

### Milestone 1: Project Skeleton And Developer Workflow

Goal: create a runnable local app with backend, frontend, tests, and basic documentation.

Tasks:

1. Create backend project structure under `backend/`.
2. Create frontend project structure under `frontend/`.
3. Add root-level developer commands or scripts for running backend, frontend, and tests.
4. Add `.gitignore` for Python, Node, local databases, env files, logs, and build output.
5. Add minimal README with local setup and run commands.
6. Add backend health endpoint.
7. Add frontend shell that can call the health endpoint.

Acceptance checks:

- Backend starts locally.
- Frontend starts locally.
- Frontend can show backend health status.
- Backend and frontend tests can run, even if coverage is minimal.

### Milestone 2: Persistence And Core Schemas

Goal: implement the local data model from the spec.

Tasks:

1. Define database models for `LearningRun`, `Source`, `Card`, `KnowledgeNode`, `KnowledgeEdge`, `ModelConfig`, and `SourceConfig`.
2. Define Pydantic schemas for API inputs and outputs.
3. Implement database initialization and migrations.
4. Implement repository/service layer for creating runs, storing sources, storing cards, and upserting graph nodes and edges.
5. Implement basic node normalization for names, aliases, tags, and source domains.
6. Add tests for model creation, persistence, and relationship writes.

Acceptance checks:

- A test can create a run with sources, cards, nodes, and edges.
- Duplicate node names normalize to one node where intended.
- Source records preserve status and status reason.

### Milestone 3: Settings And Configuration

Goal: allow the user to configure models and sources before running learning tasks.

Tasks:

1. Implement backend config loader and writer for local YAML or JSON config.
2. Implement model settings API: base URL, model name, API key reference, temperature, and max tokens.
3. Implement source settings API: built-in source toggles, RSS feeds, domains, entry URLs, and experimental search-page setting.
4. Ensure raw API keys are not returned to the frontend after save.
5. Build frontend settings page for common model and source settings.
6. Add validation and user-facing error messages for invalid URLs, missing model name, and missing API key.

Acceptance checks:

- User can save model settings.
- User can save and list source settings.
- API keys are masked after save.
- Invalid settings show clear errors.

### Milestone 4: Source Discovery

Goal: produce candidate source URLs for a keyword from configured sources.

Tasks:

1. Implement RSS discovery by keyword.
2. Implement custom entry URL discovery.
3. Implement domain and site-specific discovery hooks for a small built-in source set.
4. Implement optional experimental search-engine page discovery behind a disabled-by-default flag.
5. Implement URL normalization and deduplication.
6. Implement language hinting for Chinese and English sources.
7. Add source ranking inputs: title match, snippet match, domain priority, recency when available.
8. Add tests with fixed RSS and HTML fixtures.

Acceptance checks:

- A keyword can produce candidate sources from RSS and entry URLs.
- Duplicate URLs collapse reliably.
- Experimental search-page discovery can be disabled without breaking normal discovery.
- Discovery returns enough metadata for the crawler stage.

### Milestone 5: Crawling And Extraction

Goal: fetch source pages, extract text, and record partial or failed outcomes cleanly.

Tasks:

1. Implement HTTP fetcher with timeout, user agent, redirect handling, and content-type checks.
2. Implement extraction with the selected article extraction library.
3. Capture title, snippet, language, extracted text, status, and failure reason.
4. Implement per-mode source limits: light 5-10, standard 10-20, deep 20-50.
5. Implement simple quality scoring and filtering for empty or low-value text.
6. Implement content hashing for duplicate text detection.
7. Add tests for success, timeout, HTTP error, blocked page, empty extraction, and duplicate content.

Acceptance checks:

- One failed source does not fail the run.
- Every source has a clear status.
- Extracted text is saved when available.
- Failed extraction still saves metadata.

### Milestone 6: AI Provider And Structured Output

Goal: convert source material into validated learning output.

Tasks:

1. Implement OpenAI-compatible chat client with configurable base URL, API key, and model.
2. Define strict Pydantic schema for AI output: cards, nodes, edges, learning path, and source references.
3. Implement source batching and chunking for long pages.
4. Implement batch summarization prompt.
5. Implement merge prompt that produces Chinese structured output.
6. Implement one-shot JSON repair flow for malformed model output.
7. Implement fallback to text summary when repair fails.
8. Record approximate usage from provider response when available.
9. Add tests using mocked model responses for valid JSON, malformed JSON, failed repair, and provider errors.

Acceptance checks:

- Valid model output writes cards, nodes, and edges.
- Malformed JSON gets one repair attempt.
- Failed repair marks the run as partially successful instead of losing data.
- Provider errors surface as recoverable UI errors.

### Milestone 7: Knowledge Association

Goal: make each new run contribute to the long-term knowledge base.

Tasks:

1. Implement node upsert by normalized name and type.
2. Implement alias matching.
3. Implement tag overlap matching.
4. Implement source-domain overlap matching.
5. Implement keyword overlap matching.
6. Store confidence on automatically generated edges.
7. Add API endpoint to fetch related historical knowledge for a run.
8. Add tests for same-name merge, alias merge, weak related edge creation, and no-match cases.

Acceptance checks:

- A second related keyword can link to existing nodes.
- Duplicate obvious concepts do not create unnecessary separate nodes.
- Weak historical associations are visible but distinguishable by confidence.

### Milestone 8: Learning Run API

Goal: expose the complete keyword-to-knowledge workflow to the frontend.

Tasks:

1. Implement `POST /runs` to start a learning run.
2. Implement background task execution for discovery, crawling, AI processing, persistence, and association.
3. Implement `GET /runs/{id}` for run details.
4. Implement `GET /runs/{id}/events` or polling status endpoint for progress.
5. Implement `GET /runs` for history.
6. Implement `GET /knowledge/graph` with filters.
7. Implement cancellation or retry only if it fits cleanly; otherwise leave it for a later version.
8. Add integration tests with mocked discovery, crawler, and model.

Acceptance checks:

- A frontend can start a run and observe progress.
- Completed runs return cards, sources, graph nodes, graph edges, and related history.
- Partial success is represented clearly in API responses.

### Milestone 9: Frontend Learning Experience

Goal: build the user-facing workflow for keyword learning.

Tasks:

1. Build main layout with navigation: Learn, History, Knowledge Graph, Settings.
2. Build keyword input with mode selector defaulting to light mode.
3. Build task progress view with stage-level progress and source counts.
4. Build learning card sections for foundation and current practice output.
5. Build source list with status, reason, title, URL, language, and extracted-state indicator.
6. Build graph view with clickable nodes and edge labels.
7. Build learning path view.
8. Build related history panel.
9. Add loading, empty, partial success, and error states.
10. Add frontend tests for key rendering and interactions.

Acceptance checks:

- User can run a keyword task from the UI.
- User can inspect generated cards and sources.
- User can click graph nodes and see details.
- Partial failures are understandable without reading logs.

### Milestone 10: History, Knowledge Browsing, Import, And Export

Goal: make the knowledge base persistent and portable.

Tasks:

1. Build history page with keyword, time, mode, status, and tag filters.
2. Build knowledge graph browsing page with search and type filters.
3. Implement JSON export endpoint for runs, sources, cards, nodes, and edges.
4. Implement JSON import endpoint with validation and duplicate handling.
5. Exclude raw API keys from export.
6. Build frontend import/export controls with confirmation and result feedback.
7. Add tests for export shape, import validation, duplicate import, and key exclusion.

Acceptance checks:

- User can export knowledge data as JSON.
- User can import a valid export into a fresh database.
- API keys never appear in exported JSON.
- History can be browsed and filtered.

### Milestone 11: Manual Acceptance And Polish

Goal: verify the MVP against the spec with realistic topics.

Tasks:

1. Run manual acceptance with `AI Agent`, `RAG`, and `WebAssembly`.
2. Verify light mode uses a small source set and completes with useful output.
3. Verify standard and deep modes apply larger limits.
4. Verify Chinese and English sources can both contribute.
5. Verify failed extraction is visible and does not break the run.
6. Verify historical association after multiple related runs.
7. Review logs to confirm API keys are masked.
8. Update README with setup, configuration, and known limitations.

Acceptance checks:

- All spec acceptance criteria pass.
- The app can be used locally by following README instructions.
- Known limitations are documented without blocking MVP use.

## Suggested Build Order

1. Project skeleton.
2. Database and schemas.
3. Settings.
4. Source discovery.
5. Crawling and extraction.
6. AI provider and structured output.
7. Knowledge association.
8. Learning run API.
9. Frontend learning workflow.
10. History and import/export.
11. Manual acceptance and polish.

This order keeps the backend workflow testable before the full UI exists, then connects the UI once the API behavior is stable.

## API Surface Draft

### Health

- `GET /health`

### Settings

- `GET /settings/model`
- `PUT /settings/model`
- `GET /settings/sources`
- `PUT /settings/sources`

### Runs

- `POST /runs`
- `GET /runs`
- `GET /runs/{run_id}`
- `GET /runs/{run_id}/status`

### Knowledge

- `GET /knowledge/graph`
- `GET /knowledge/nodes/{node_id}`
- `GET /knowledge/search`

### Import And Export

- `GET /export`
- `POST /import`

## Test Plan

### Backend

Run backend tests on every backend change:

- Unit tests for config parsing, URL deduplication, extraction status, AI schema validation, persistence, and import/export.
- Integration tests for a full mocked learning run.
- Regression fixtures for crawler and extractor edge cases.

### Frontend

Run frontend tests on every UI change:

- Component tests for settings, keyword input, cards, sources, graph node details, history, and import/export.
- API mock tests for loading, error, partial success, and empty states.

### Manual

Before considering the MVP complete:

- Run `AI Agent`, `RAG`, and `WebAssembly` in light mode.
- Run at least one standard mode query.
- Run at least one query with a deliberately failing source.
- Export, reset or use a fresh database, and import the exported data.

## Risks And Mitigations

### Crawling Reliability

Risk: sites may block requests, require JavaScript, or return noisy content.

Mitigation: record per-source status, degrade to metadata, keep search-page crawling experimental, and prioritize configurable sources and RSS.

### AI Output Quality

Risk: the model may produce invalid JSON or unsupported relationships.

Mitigation: strict schema validation, one repair attempt, fallback text summary, and tests with malformed responses.

### Token Cost

Risk: deep mode can become expensive.

Mitigation: default to light mode, deduplicate sources before AI calls, truncate or chunk long documents, and record usage estimates.

### Knowledge Graph Noise

Risk: automatic association may create weak or incorrect relationships.

Mitigation: store confidence, use conservative matching rules, and distinguish weak related edges from stronger same-name or alias merges.

### Secret Leakage

Risk: API keys may leak into logs or exports.

Mitigation: mask keys in API responses and logs, store key references instead of raw values where possible, and test export output for secret exclusion.

## Definition Of Done

The MVP is done when:

- The app runs locally with documented commands.
- The user can configure an OpenAI-compatible model and custom sources.
- The user can run a keyword in light, standard, or deep mode.
- The default mode is light.
- The app gathers Chinese and English sources.
- The app attempts body extraction and records per-source status.
- The app generates Chinese foundation and current-practice learning cards.
- The app generates a learning path and clickable knowledge graph.
- Results are saved into SQLite as reusable knowledge data.
- New results automatically associate with historical knowledge.
- The user can browse history and graph data.
- The user can export and import knowledge JSON.
- Backend and frontend tests cover the critical workflow.
- Manual acceptance passes for `AI Agent`, `RAG`, and `WebAssembly`.

