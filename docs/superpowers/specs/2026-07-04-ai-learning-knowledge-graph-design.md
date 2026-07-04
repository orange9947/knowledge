# AI Learning Knowledge Graph Design

Date: 2026-07-04

## Goal

Build a local-first learning assistant. The user enters a keyword, and the app gathers related materials from configurable sources, extracts page content where possible, uses an OpenAI-compatible model to organize the material, and saves the result into a growing personal knowledge base.

The first version focuses on personal use. It should help the user quickly learn both foundational concepts and current industry practices, projects, tools, and skills. It should also preserve history as reusable knowledge graph data rather than isolated search reports.

## Scope

### In Scope

- Local Web MVP with a React frontend and Python backend.
- OpenAI-compatible model configuration with base URL, API key, and model name.
- Chinese and English source collection, with final learning output in Chinese.
- Configurable sources: built-in common technology sources, RSS feeds, custom domains, custom entry URLs, and an optional experimental search-engine page crawler.
- Best-effort webpage body extraction.
- Structured AI output for learning cards, current practices, learning path, and knowledge graph.
- Persistent local knowledge base using SQLite.
- Automatic association between new results and historical knowledge.
- JSON import and export for migration and backup.

### Out of Scope For Version 1

- User accounts.
- Cloud sync.
- Desktop packaging with Tauri or Electron.
- Android app.
- Multi-user collaboration.
- Manual editing of graph nodes and relationships.
- Advanced spaced repetition or review workflows.
- Large-scale unrestricted web crawling.

## Recommended Approach

Use a local Web MVP first. The backend exposes a local API and owns crawling, extraction, AI orchestration, validation, persistence, and import/export. The frontend is a React single-page app that reads and writes through this API.

This approach keeps the first version practical while preserving future paths:

- A desktop app can later wrap the same frontend and start the local backend.
- An Android app can reuse the API concepts and data model.
- The model integration can support DeepSeek, OpenAI, local model gateways, or compatible providers through the same adapter.

## Architecture

### Frontend

The React frontend provides:

- Keyword input and mode selection.
- Task progress and source status.
- Learning card views.
- Knowledge graph view.
- Learning path view.
- History and knowledge base browsing.
- Settings for model and common source configuration.
- Import and export actions.

The frontend does not access the database, crawler, or model provider directly.

### Backend

The Python backend provides:

- Local HTTP API.
- Source discovery and source configuration.
- Webpage fetching and content extraction.
- AI prompt orchestration and provider calls.
- Structured response validation and repair.
- Knowledge graph persistence.
- History association.
- Import and export.

### Storage

SQLite stores local knowledge data. YAML or JSON stores local configuration. API keys are stored locally and excluded from exported knowledge files by default.

## Components

### Source Manager

The Source Manager owns all source configuration and discovery. It supports:

- Built-in technology source rules.
- RSS feeds.
- Custom domains.
- Custom entry URLs.
- Optional experimental search-engine page crawling.

The primary discovery path is configurable sources plus a small number of built-in rules. Search-engine page crawling is a supplemental experimental feature and should not be required for the main workflow.

### Crawler And Extractor

The crawler fetches candidate pages and attempts to extract the main body. It records source status for every page:

- `success`: body extracted and usable.
- `partial`: metadata or partial text available, but extraction was incomplete.
- `failed`: fetch or extraction failed.
- `skipped`: source was filtered out by rules, duplicate detection, or limits.

When body extraction fails, the system still preserves URL, title, summary or snippet if available, site, language, and failure reason.

### AI Orchestrator

The AI Orchestrator calls an OpenAI-compatible API. It accepts base URL, API key, and model name from local configuration.

Its responsibilities:

- Summarize source batches.
- Merge batch summaries.
- Produce structured Chinese learning output.
- Generate graph nodes and relationships.
- Generate a learning path.
- Ask the model to repair malformed JSON once when validation fails.

### Knowledge Store

The Knowledge Store persists runs, sources, cards, graph nodes, graph edges, and configuration metadata. New runs are added to the long-term knowledge base and automatically associated with historical nodes.

Version 1 association uses practical rules:

- Same normalized name.
- AI-provided aliases.
- Shared tags.
- Shared source domains.
- Keyword overlap.

The data model can later add embeddings and stronger semantic matching without changing the user-facing workflow.

### Web UI

The Web UI presents both learning cards and graph views. The default result page shows:

- Foundation cards.
- Current practice, project, tool, and skill cards.
- Source list with status.
- Clickable knowledge graph.
- Learning path.
- Links to related historical knowledge.

## Data Model

### LearningRun

Represents one keyword learning task.

Fields:

- `id`
- `keyword`
- `mode`: `light`, `standard`, or `deep`
- `status`
- `created_at`
- `completed_at`
- `language_policy`
- `source_count`
- `model_provider_config_id`
- `token_usage_estimate`
- `error_summary`

### Source

Represents one crawled or discovered material source.

Fields:

- `id`
- `run_id`
- `url`
- `title`
- `site`
- `language`
- `published_at`
- `status`
- `status_reason`
- `snippet`
- `extracted_text`
- `content_hash`
- `quality_score`

### Card

Represents one AI-generated learning card.

Types:

- `foundation`
- `term`
- `learning_path`
- `current_practice`
- `project_tool`
- `recommended_reading`

Fields:

- `id`
- `run_id`
- `type`
- `title`
- `summary`
- `details`
- `source_ids`
- `node_ids`
- `sort_order`

### KnowledgeNode

Represents a graph node.

Types:

- `keyword`
- `concept`
- `skill`
- `project`
- `tool`
- `source`

Fields:

- `id`
- `type`
- `name`
- `normalized_name`
- `summary`
- `aliases`
- `tags`
- `created_at`
- `updated_at`

### KnowledgeEdge

Represents a relationship between nodes.

Types:

- `prerequisite`
- `contains`
- `related`
- `applied_by`
- `supported_by_source`

Fields:

- `id`
- `source_node_id`
- `target_node_id`
- `type`
- `confidence`
- `evidence_source_ids`
- `created_at`

### ModelConfig

Stores model connection configuration.

Fields:

- `id`
- `name`
- `base_url`
- `model`
- `api_key_reference`
- `default_temperature`
- `max_tokens`

The export format does not include raw API keys.

### SourceConfig

Stores source configuration.

Fields:

- `id`
- `name`
- `type`: `builtin`, `rss`, `domain`, `entry_url`, or `search_page`
- `enabled`
- `url_or_domain`
- `language_hint`
- `crawl_depth`
- `rate_limit`
- `extractor_rule`

## Task Flow

1. The user enters a keyword and chooses a mode.
2. The backend loads model and source configuration.
3. The Source Manager discovers candidate sources from built-in rules, RSS, custom domains, custom entry URLs, and optionally search-engine result pages.
4. The backend deduplicates URLs and applies the selected mode limit.
5. The crawler fetches pages and extracts body content where possible.
6. The backend filters low-quality or irrelevant sources.
7. The AI Orchestrator summarizes source batches.
8. The AI Orchestrator merges summaries into validated structured output.
9. The Knowledge Store writes the learning run, sources, cards, nodes, and edges.
10. The Knowledge Store associates new nodes with historical knowledge.
11. The frontend displays cards, graph, learning path, source status, and related history.

## Modes

### Light

Default mode. Uses about 5 to 10 sources. Optimized for speed and cost.

### Standard

Uses about 10 to 20 sources. Optimized for balanced coverage.

### Deep

Uses about 20 to 50 sources. Optimized for broader research and higher cost.

## Output Structure

The AI output should include:

- Basic concepts.
- Key terms.
- Learning path.
- Current industry practices.
- Current projects, tools, libraries, or frameworks.
- Practical skills to learn.
- Recommended readings.
- Knowledge graph nodes.
- Knowledge graph edges.
- Source references.

The final user-facing language is Chinese.

## Error Handling

The system should keep tasks useful even when some steps fail.

- One failed source does not fail the run.
- Fetch timeouts, HTTP errors, blocked pages, captchas, and empty extraction results are recorded per source.
- If no body can be extracted, the source can still contribute title, snippet, URL, and metadata.
- If AI JSON validation fails, the backend asks the model to repair the response once.
- If repair fails, the backend saves text output and marks the run as partially successful.
- If model calls fail, the frontend shows a recoverable error and allows retry after settings are changed.

## Privacy And Security

- Data is stored locally by default.
- No account or cloud sync exists in version 1.
- API keys are stored locally.
- API keys are not included in knowledge exports by default.
- Logs must not include complete API keys.
- Exports include learning data, source metadata, cards, nodes, and edges.

## Cost Controls

- Light mode is the default.
- The backend deduplicates and filters sources before model calls.
- Long pages are truncated or chunked before summarization.
- Batch summaries are merged instead of sending all raw text in one request.
- The app records approximate model usage per run.
- The settings page shows model, mode, and expected source count before a run starts.

## Testing Strategy

### Unit Tests

Cover:

- Source configuration parsing.
- URL normalization and deduplication.
- Extraction status handling.
- AI JSON validation.
- Knowledge node and edge persistence.
- Import and export serialization.

### Integration Tests

Use fixed page samples and mocked model responses to test:

- Full keyword task flow.
- Successful extraction.
- Partial extraction.
- Failed extraction.
- Structured output write.
- Historical node association.

### Frontend Tests

Cover:

- Settings save behavior.
- Task progress display.
- Learning card rendering.
- Graph node click behavior.
- History filtering.
- Import and export actions.

### Manual Acceptance Tests

Use at least these keywords:

- `AI Agent`
- `RAG`
- `WebAssembly`

For each keyword, light mode should produce useful Chinese output with foundation cards, current practice cards, sources, a clickable graph, a learning path, and saved history associations.

## Acceptance Criteria

Version 1 is complete when:

- A user can configure an OpenAI-compatible model.
- A user can configure built-in and custom sources.
- A user can enter a keyword and run light, standard, or deep mode.
- Light mode is the default.
- The app gathers Chinese and English materials.
- The app attempts body extraction and records per-source status.
- Failed extraction degrades gracefully.
- The app generates Chinese learning cards for foundations and current practices.
- The app generates a learning path.
- The app generates clickable graph nodes and relationships.
- The app saves each run into a persistent local knowledge base.
- New runs automatically associate with related historical knowledge.
- The app can export and import the knowledge base as JSON.

