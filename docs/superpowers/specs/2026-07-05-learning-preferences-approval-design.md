# Learning Preferences and Graph Approval Design

## Context

The current learning flow stores AI reading analysis cards and immediately persists related graph nodes and edges. That is too eager for exploratory learning: low-value or irrelevant model output can pollute the knowledge graph before the user reviews it.

This design changes the learning flow to a two-stage process:

1. AI creates candidate learning cards from collected materials.
2. The user selects useful cards and explicitly promotes them into the knowledge graph.

The flow also adds learning preference prompts so the model can summarize materials according to the user's level and interests.

## Goals

- Let each knowledge base store a default learning preference prompt.
- Let each learning run add a one-time preference prompt.
- Use both prompts when AI summarizes materials or selects AI collection targets.
- Keep AI-generated cards visible in the learning panel as candidates.
- Do not create graph nodes or edges until the user approves selected cards.
- Show clear card status: pending approval or added to graph.

## Non-Goals

- No multi-user permission model.
- No separate desktop or Android sync design in this change.
- No full node/edge editor yet.
- No automatic semantic merge UI for similar nodes beyond the existing backend upsert behavior.

## Recommended Approach

Add a candidate approval stage while preserving the current card-first learning experience.

AI output will still contain cards, nodes, and edges. Cards are stored immediately with an approval status. Candidate node and edge payloads are preserved in the card metadata or related candidate storage until approval. When the user approves selected cards, the backend creates or updates graph nodes and edges only for the approved cards.

This keeps the learning panel useful immediately while protecting the graph from unreviewed output.

## Data Model

Knowledge bases gain:

- `learning_prompt`: optional text storing the default learning preference for that knowledge base.

Learning runs gain:

- `learning_prompt`: optional text storing the one-time prompt for that run.

Cards gain:

- `approval_status`: `candidate` or `approved`.
- `candidate_payload`: JSON containing the related candidate nodes and edges needed to promote the card.

Existing cards can default to `approved` during migration or compatibility handling, because they were already persisted into the graph under the old behavior.

## API Changes

Knowledge base APIs:

- Create/update knowledge base accepts `learning_prompt`.
- Read knowledge base returns `learning_prompt`.

Run APIs:

- Create run accepts optional `learning_prompt`.
- AI summarize uses knowledge base prompt plus run prompt.
- AI collect target selection also receives those prompts.

Card approval APIs:

- `POST /runs/{run_id}/cards/approve`
- Payload: selected `card_ids`.
- Behavior: approve only candidate cards in that run, create graph nodes and edges from their candidate payloads, refresh graph data through existing graph endpoints.

## AI Prompt Behavior

Model prompts include this context:

- Knowledge base default learning preference.
- Current run one-time learning preference.
- Instruction to prioritize useful knowledge based on those preferences.

Example preference:

```text
我是初学者，优先解释基础概念、学习路径和能跟着做的小项目。
```

The model should still return structured JSON. The prompt changes the selection criteria, not the schema.

## Frontend Behavior

Learning panel adds a compact preference area:

- Knowledge base default learning preference textarea.
- Current run preference textarea near the keyword input.

Reading analysis cards add:

- Checkbox for candidate cards.
- Status label: `待加入图谱` or `已加入图谱`.
- Actions:
  - `全选待加入`
  - `加入选中知识`

Graph panel remains scoped to approved knowledge only. Candidate cards do not appear in the graph.

## Error Handling

- Approving no cards returns a user-readable validation error.
- Approving cards from another run returns not found or validation error.
- Re-approving an approved card is idempotent: it should not duplicate graph edges.
- If a candidate card has malformed candidate payload, the backend skips invalid relations and returns a readable partial error or marks only valid cards approved.

## Testing

Backend tests:

- Run creation stores one-time prompt.
- Knowledge base stores default prompt.
- AI prompt builder includes both prompts.
- Generated cards are candidates by default.
- Candidate cards do not create graph nodes before approval.
- Approval creates graph nodes and edges.
- Re-approval is safe.

Frontend tests:

- Preference fields render and pass values into run creation.
- Candidate cards can be selected.
- Approve button calls approval API and refreshes graph/cards.
- Approved cards show the approved status.

## Acceptance Criteria

- A new AI summary creates candidate cards but does not change the graph count until approval.
- User can select one or more candidate cards and add them to the graph.
- User can set a knowledge base learning preference and a one-time run preference.
- AI requests include both preference prompts.
- Existing graph view only shows approved knowledge.
