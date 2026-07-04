# Knowledge Base Isolation and Navigation Design

## Goal

Add explicit knowledge bases so learning runs, generated cards, and graph relationships do not all merge into one global graph. Make the left sidebar behave as real navigation, where each button opens the matching workspace view.

## Behavior

- The app creates a default knowledge base on startup.
- Users can create and switch knowledge bases.
- A keyword run belongs to exactly one knowledge base: the currently selected one.
- Generated graph nodes and edges are scoped to that run's knowledge base.
- History, graph, cards, and export/import views filter by the selected knowledge base.
- Different knowledge bases do not automatically link to each other.

## Backend Design

- Add a `KnowledgeBase` model with `id`, `name`, optional `description`, and timestamps.
- Add `knowledge_base_id` to `LearningRun`, `KnowledgeNode`, and `KnowledgeEdge`.
- Change node de-duplication from global `(type, normalized_name)` to per-knowledge-base `(knowledge_base_id, type, normalized_name)`.
- Add API endpoints:
  - `GET /knowledge-bases`
  - `POST /knowledge-bases`
- Extend existing APIs:
  - `POST /runs` accepts `knowledge_base_id`.
  - `GET /runs` accepts `knowledge_base_id`.
  - `GET /knowledge/graph` accepts `knowledge_base_id`.
  - `GET /export` accepts optional `knowledge_base_id`.
  - `POST /import` preserves imported knowledge base data and places old exports into the default knowledge base.

## Frontend Design

- Load knowledge bases on startup and select the first available default.
- Add a compact knowledge base selector in the top bar and creation controls in Settings.
- Send the active `knowledge_base_id` when creating a run.
- Refresh runs, cards, sources, and graph when the active knowledge base changes.
- Change the sidebar buttons into real view switches:
  - Learn: keyword run controls, learning cards, extraction/source status.
  - Graph: current knowledge base graph.
  - History: current knowledge base run history plus import/export.
  - Settings: model settings, source settings, and knowledge base creation.

## Error Handling

- Creating a run with a missing knowledge base returns 404.
- Graph and history requests with an unknown knowledge base return empty scoped results only when no ID is supplied; an invalid explicit ID returns 404.
- Import keeps existing records when IDs already exist and avoids cross-linking nodes across knowledge bases.

## Testing

- Backend tests cover default knowledge base creation, scoped runs, scoped graph data, and import/export compatibility.
- Frontend tests cover knowledge base loading and sidebar view switching.
