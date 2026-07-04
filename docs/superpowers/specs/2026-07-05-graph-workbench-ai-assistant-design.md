# Knowledge Graph Workbench and AI Assistant Design

## Purpose

The current knowledge graph becomes hard to read as node count grows because it uses a fixed grid layout and always renders every visible relationship. This change turns the graph page into a focused learning workbench: it should help the user explore one topic at a time, ask questions about the graph, supplement missing knowledge from the web, and selectively promote useful assistant output into the graph.

## Scope

This design covers two linked upgrades:

- Replace the fixed graph canvas with an interactive graph workbench.
- Add a collapsible graph-side AI assistant that can answer questions, use web supplementation, and create candidate knowledge cards for manual approval.

The assistant must not write directly into the graph. New AI-derived knowledge always becomes a candidate that the user selects before adding to the graph.

## Current State

The frontend renders the graph in `GraphPanel` and places nodes with `buildGraphLayout`. The layout is a bounded grid, and edges are SVG lines between grid coordinates. This works for a small number of nodes but quickly creates crossings and label clutter.

The backend already has:

- model configuration and connection testing
- learning source discovery
- source crawling
- AI generation and summarization
- candidate card approval into graph nodes and edges

The new assistant should reuse these paths where possible instead of creating a separate knowledge-writing flow.

## Recommended Approach

Use a graph library for the canvas and keep the backend graph schema intact. The first implementation should use AntV G6 because it supports force/radial layouts, combo grouping, collapse/expand behavior, Canvas/WebGL rendering paths, and graph interactions that fit this product.

The graph page will support three views:

- Relationship exploration: default view centered on a selected or searched node.
- Type grouping: nodes grouped by concept, skill, tool, method, project, keyword, and source.
- Learning path: left-to-right progression from foundation concepts to methods, projects, and source evidence.

The AI assistant will live as a right-side drawer on the graph page. It will use the current knowledge base, selected graph node, approved cards, and relevant sources as primary context. If that context is insufficient and web access is allowed, it will discover and crawl web materials through the existing learning source configuration.

## Graph Workbench Behavior

Relationship exploration is the default. It should avoid rendering the whole graph when there are many nodes.

Core behavior:

- Start with a focused subgraph rather than all nodes.
- If a node is selected, show that node and neighbors up to the selected depth.
- If no node is selected, show high-signal nodes based on graph degree, recency, and keyword matches.
- Provide controls for relation depth: 1, 2, or 3.
- Provide filters for node type and keyword search.
- Dim unrelated nodes and edges instead of removing context abruptly.
- Show labels only for selected, hovered, and high-priority nodes at low zoom.
- Keep the node detail/editor panel available.

Type grouping view should group nodes by type and allow groups to collapse. This is for overview and cleanup.

Learning path view should organize graph content into a reading order:

- foundation and keywords
- concepts
- skills, tools, and methods
- projects and usage patterns
- source evidence

The first version can infer this order from existing node types and card types. It does not need a new database table.

## AI Assistant Behavior

The assistant appears only on the knowledge graph page. It is collapsed by default and expands from the right side.

Inputs:

- current knowledge base id
- user question
- selected node id, if any
- active graph filters, if useful
- `allow_web`, default true for this feature
- optional instruction to generate candidate cards

Answering flow:

1. Build local context from the current knowledge base.
2. Prioritize the selected node and its nearby nodes/edges.
3. Include approved cards and source snippets connected to those nodes.
4. Ask the configured model to answer from local context first.
5. If local context is insufficient and `allow_web` is true, discover web candidates using existing source configs.
6. Crawl useful pages and ask the model to supplement the answer.
7. Return a clear answer with sections for graph content, web supplementation, and model inference when applicable.

The assistant should clearly separate evidence types:

- Graph content: already in this knowledge base.
- Web supplementation: retrieved during this assistant request.
- Model inference: reasoning that is not directly present in graph or web evidence.

The assistant should return citations as structured references, not just inline text.

## Candidate Knowledge Flow

The enhanced assistant can produce candidate cards from its answer. Candidate cards should not automatically enter the graph.

Candidate behavior:

- The assistant response may include extracted candidate cards.
- Candidate cards use the same approval principle as learning-run cards.
- The user can select one or more assistant candidates and click "add to graph".
- On approval, backend creates or updates nodes and edges in the active knowledge base.
- If a candidate came from web supplementation, its source references should remain attached.

The first implementation should reuse the existing learning run and card approval path by creating an assistant-generated run whose keyword is derived from the question. This keeps approval, source references, and graph promotion consistent. A separate assistant run table should only be added later if the reused run becomes confusing in the history UI.

## Backend Design

Add schemas for assistant requests and responses.

Request:

- `knowledge_base_id`
- `question`
- `selected_node_id`
- `allow_web`
- `create_candidates`

Response:

- `answer`
- `used_web`
- `graph_references`
- `web_references`
- `candidate_cards`
- `warnings`

Add service logic in a dedicated assistant service. It should depend on:

- `KnowledgeRepository` for graph, card, source, and model config access
- `AIOrchestrator` for model calls
- existing discovery and crawling services for web supplementation

Potential endpoints:

- `POST /knowledge/assistant/query`
- `POST /knowledge/assistant/candidates/approve`

The query endpoint returns both the answer and candidate cards when requested. The approval endpoint promotes selected candidates into the graph.

## Frontend Design

Replace the fixed graph canvas inside `GraphPanel` with a graph workbench component.

Main UI:

- top toolbar with view tabs: relationship exploration, type grouping, learning path
- search input for nodes
- type filter controls
- relation depth control
- fit/center controls
- graph canvas
- existing node detail/editor panel
- AI assistant drawer trigger on the right side

AI assistant drawer:

- question input
- toggle for web supplementation
- answer stream or loading state
- reference sections for graph and web sources
- candidate card list with checkboxes
- action to add selected candidates to graph

The drawer should respect the selected graph node. When a node is selected, the assistant should show that it is answering in that node context.

## Error Handling

Graph rendering:

- If G6 fails to initialize, show a usable fallback list of nodes.
- If graph is empty, preserve the existing empty state and create-node action.

Assistant:

- If model config is missing, show a clear message asking the user to configure the model.
- If web supplementation fails, answer from graph context and show a warning.
- If no relevant context is found, say so directly and offer to search the web.
- If candidate approval fails, leave candidates selected and show the error.

## Testing

Backend tests:

- local graph context retrieval prioritizes selected node neighborhood
- assistant response works without web
- assistant response can include web supplementation
- candidate approval creates nodes and edges only after explicit approval
- missing model config returns a clear error

Frontend tests:

- graph page renders workbench controls
- selecting a node updates assistant context
- assistant drawer opens and submits a question
- assistant response shows graph and web references separately
- candidate selection calls the approval endpoint

Build verification:

- backend test suite
- frontend test suite
- frontend production build

## Implementation Notes

Keep the first implementation practical:

- Do not add vector search yet.
- Do not stream responses until the non-streaming flow works reliably.
- Do not auto-save web supplementation into the graph.
- Do not migrate existing graph data.
- Keep current node and edge schemas unless implementation proves a missing field is necessary.

The priority is readability, trustworthy assistant answers, and manual control over graph growth.
