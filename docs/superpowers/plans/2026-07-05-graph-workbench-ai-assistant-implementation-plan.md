# Knowledge Graph Workbench and AI Assistant Implementation Plan

Date: 2026-07-05

Related spec: `docs/superpowers/specs/2026-07-05-graph-workbench-ai-assistant-design.md`

## Objective

Upgrade the knowledge graph page into a focused graph workbench and add a graph-side AI assistant. The workbench should stay readable as the graph grows. The assistant should answer questions from the active knowledge base, optionally supplement from the web, and create candidate knowledge cards that require manual approval before entering the graph.

## Implementation Principles

- Keep graph writes behind explicit user approval.
- Reuse the existing learning run, card, source, and approval paths where possible.
- Prefer focused subgraphs over rendering every node and edge.
- Keep model and web failures recoverable.
- Clearly separate graph evidence, web supplementation, and model inference.
- Ship the first version without vector search or streaming; add those later only if needed.

## Milestone 1: Graph Data Utilities

Goal: make graph filtering and layout preparation testable outside the React component.

Tasks:

1. Extract graph helper logic from `App.tsx` into a frontend utility module.
2. Add functions to compute node degree and neighbor sets.
3. Add focused-subgraph selection by selected node and depth.
4. Add fallback high-signal node selection when no node is selected.
5. Add learning-path ordering from existing node and card types.
6. Add type grouping data preparation.
7. Add unit tests for depth filtering, type filtering, search filtering, and empty graph behavior.

Acceptance checks:

- A graph with many nodes returns a bounded focused subgraph.
- Selecting a node includes related nodes up to the chosen depth.
- Type filters and keyword search apply before rendering.
- Empty graph behavior remains stable.

## Milestone 2: Graph Workbench UI

Goal: replace the fixed grid view with an interactive graph workbench.

Tasks:

1. Add AntV G6 to the frontend dependency set.
2. Create a `GraphWorkbench` component that owns G6 initialization and cleanup.
3. Support relationship exploration view with focused subgraph data.
4. Support type grouping view with grouped or combo-like rendering.
5. Support learning path view with left-to-right ordering.
6. Add controls for view mode, node search, node type filters, relation depth, fit view, and center selected node.
7. Preserve selection behavior so clicking a graph node updates the existing node detail panel.
8. Keep a fallback list if the graph library fails to initialize.
9. Update CSS so the graph area is dense, readable, and works in desktop and smaller widths.

Acceptance checks:

- Graph page no longer uses the fixed grid layout for normal rendering.
- Node selection still opens and updates the detail/editor panel.
- The graph remains readable with dozens of nodes.
- The graph page has controls for search, filters, and depth.
- Frontend tests cover the primary controls.

## Milestone 3: Assistant API Schemas

Goal: define the backend contract for graph assistant queries and candidate approval.

Tasks:

1. Add request schema for assistant query:
   - `knowledge_base_id`
   - `question`
   - `selected_node_id`
   - `allow_web`
   - `create_candidates`
2. Add response schemas for:
   - answer text
   - graph references
   - web references
   - candidate cards
   - warnings
   - `used_web`
3. Add a schema for candidate approval by card id or returned candidate id.
4. Add API route stubs under `/knowledge/assistant`.
5. Add validation tests for missing question, missing knowledge base, and invalid node id.

Acceptance checks:

- Backend exposes a typed query endpoint.
- Invalid assistant requests return clear errors.
- Response shape is stable for frontend integration.

## Milestone 4: Local Graph Context Retrieval

Goal: build reliable context for assistant answers from existing knowledge data.

Tasks:

1. Add repository/service methods to fetch graph nodes and edges by knowledge base.
2. Add selected-node neighborhood retrieval.
3. Retrieve approved cards related to selected or nearby nodes.
4. Retrieve source snippets or extracted text attached to relevant cards.
5. Rank context by selected node, graph distance, card recency, and source quality.
6. Trim context to a bounded prompt budget.
7. Add tests for selected-node prioritization and fallback context.

Acceptance checks:

- Selected node context is prioritized over unrelated knowledge.
- Assistant context includes nodes, edges, cards, and source evidence when available.
- Context trimming is deterministic and testable.

## Milestone 5: Assistant Model Orchestration

Goal: answer questions from local graph context and produce structured candidate cards.

Tasks:

1. Add `AIOrchestrator` method for graph assistant responses.
2. Build a prompt that requires separate sections for graph content, web supplementation, and model inference.
3. Define strict JSON output for answer, references, and candidate cards.
4. Add one repair attempt for malformed assistant JSON.
5. Return a clear missing-model error if no configured API key exists.
6. Convert assistant candidate payloads into existing card-compatible data.
7. Add mocked model tests for valid output, malformed output repair, missing model config, and no candidates.

Acceptance checks:

- Assistant can answer from local graph context.
- Assistant can return candidate cards without writing them to the graph.
- Provider errors are surfaced as recoverable API errors.

## Milestone 6: Web Supplementation

Goal: allow the assistant to supplement missing graph context through existing learning sources.

Tasks:

1. Reuse source config discovery for assistant web searches.
2. Reuse crawler extraction for selected web candidates.
3. Limit assistant web supplementation to a small bounded source set in the first version.
4. Include fetched web sources as temporary evidence in the assistant prompt.
5. Persist web sources only when creating an assistant-generated run for candidates.
6. Mark response references as web supplementation.
7. Add tests with mocked discovery and crawler results.

Acceptance checks:

- `allow_web=false` never performs web discovery.
- `allow_web=true` can supplement answers when local context is weak.
- Web failures do not prevent a graph-only answer.
- Web references are clearly separated from graph references.

## Milestone 7: Candidate Persistence And Approval

Goal: let the user promote assistant-generated knowledge through the existing review path.

Tasks:

1. When candidate creation is requested, create an assistant-generated learning run tied to the active knowledge base.
2. Store assistant web sources on that run when web evidence was used.
3. Store candidate cards with `approval_status="candidate"`.
4. Ensure candidate payloads contain proposed nodes and edges.
5. Add an approval endpoint or reuse the existing card approval endpoint if the frontend can address the generated run.
6. After approval, refresh graph data and mark approved cards.
7. Add tests proving candidates do not enter the graph before approval.

Acceptance checks:

- Assistant answers alone do not mutate graph nodes or edges.
- Candidate cards are visible and selectable.
- Approved assistant candidates create or update graph nodes and edges.
- Source references remain attached where possible.

## Milestone 8: Assistant Drawer UI

Goal: add the right-side assistant experience to the graph page.

Tasks:

1. Add API client methods for assistant query and candidate approval.
2. Add drawer state to the graph page.
3. Build assistant drawer with question input, web toggle, submit action, loading state, and error state.
4. Display active node context when a graph node is selected.
5. Render answer sections for graph content, web supplementation, and model inference.
6. Render graph and web references separately.
7. Render candidate cards with checkboxes and an add-to-graph action.
8. Refresh graph, cards, and node selection after candidate approval.
9. Add frontend tests for opening drawer, submitting a question, showing references, and approving candidates.

Acceptance checks:

- Assistant drawer appears only in the graph workspace.
- Selected node context is visible and sent with the question.
- Web supplementation can be toggled.
- Candidate approval updates the graph after explicit user action.

## Milestone 9: Integration And Polish

Goal: make the workbench and assistant feel coherent in normal use.

Tasks:

1. Verify graph workbench with small, medium, and large local graphs.
2. Verify assistant behavior with configured and missing model settings.
3. Verify assistant graph-only and web-enabled answers.
4. Verify candidate approval and graph refresh.
5. Tune prompt wording for Chinese answers and concise references.
6. Tune graph colors, labels, and controls for readability.
7. Update usage guide if the current guide documents the graph page.

Acceptance checks:

- The graph stays usable once node count grows beyond the old grid comfort zone.
- Assistant answers are understandable and cite evidence categories.
- Web supplementation is optional and visibly marked.
- Manual candidate approval remains the only path into the graph.

## Suggested Build Order

1. Graph data utilities.
2. Graph workbench UI with G6.
3. Assistant schemas and local context retrieval.
4. Assistant model orchestration.
5. Web supplementation.
6. Candidate persistence and approval.
7. Assistant drawer UI.
8. End-to-end verification and polish.

This order fixes graph readability first, then layers the assistant onto stable graph selection and context behavior.

## API Surface Draft

### Assistant

- `POST /knowledge/assistant/query`
- `POST /knowledge/assistant/candidates/approve`

### Existing Endpoints Reused

- `GET /knowledge/graph`
- `GET /knowledge/nodes/{node_id}`
- `POST /runs/{run_id}/cards/approve`
- `GET /runs/{run_id}/cards`
- `GET /runs/{run_id}/sources`

## Test Plan

### Backend

Run backend tests after each backend milestone:

- assistant schema validation
- graph context ranking
- model orchestration with mocked responses
- web supplementation with mocked discovery/crawler
- candidate persistence and approval
- missing model and provider error cases

### Frontend

Run frontend tests after each frontend milestone:

- graph workbench controls
- node selection and context propagation
- assistant drawer open/close and submit
- reference rendering
- candidate selection and approval

### Manual

Before calling the feature complete:

- Create or load a graph with at least 30 nodes.
- Search and focus several nodes.
- Switch between relationship, type grouping, and learning path views.
- Ask a graph-only question.
- Ask a web-enabled question.
- Generate candidate cards from the assistant.
- Approve selected candidates and confirm the graph updates.

## Risks And Mitigations

### Graph Library Integration

Risk: G6 integration may introduce lifecycle or rendering issues in React.

Mitigation: isolate G6 inside a small component with explicit initialization, update, and destroy behavior. Keep a fallback list view.

### Graph Clutter Persists

Risk: a better layout alone may still be cluttered.

Mitigation: default to focused subgraphs, hide low-priority labels, and make depth/filter controls prominent.

### Assistant Hallucination

Risk: the assistant may present model inference as fact.

Mitigation: require structured evidence categories and render graph, web, and inference sections separately.

### Web Supplementation Noise

Risk: web search may fetch low-value or irrelevant pages.

Mitigation: reuse source filtering, keep assistant source limits small, and mark web content as supplementation rather than graph truth.

### Candidate Graph Pollution

Risk: assistant candidates may add noisy nodes.

Mitigation: keep candidates out of the graph until explicit approval and reuse the existing manual selection workflow.

## Definition Of Done

The feature is done when:

- The graph page uses an interactive workbench instead of the old fixed grid.
- The user can search, filter, change depth, and switch graph views.
- Selecting a graph node affects both graph focus and assistant context.
- The assistant can answer from the active knowledge base.
- The assistant can optionally supplement from the web.
- The answer distinguishes graph content, web supplementation, and model inference.
- The assistant can create candidate cards.
- Candidate cards do not affect the graph until approved.
- Approved assistant candidates update the graph.
- Backend and frontend tests cover the critical workflow.
- Frontend production build passes.
