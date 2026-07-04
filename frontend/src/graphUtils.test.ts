import { describe, expect, it } from "vitest";

import { focusedNodeIds, prepareGraphData } from "./graphUtils";
import type { GraphData } from "./api";

const graph: GraphData = {
  nodes: [
    { id: 1, knowledge_base_id: 1, type: "keyword", name: "RAG", normalized_name: "rag", summary: null, aliases: [], tags: [] },
    { id: 2, knowledge_base_id: 1, type: "concept", name: "检索", normalized_name: "检索", summary: null, aliases: [], tags: [] },
    { id: 3, knowledge_base_id: 1, type: "skill", name: "重排序", normalized_name: "重排序", summary: null, aliases: [], tags: [] },
    { id: 4, knowledge_base_id: 1, type: "project", name: "问答项目", normalized_name: "问答项目", summary: null, aliases: [], tags: [] },
  ],
  edges: [
    { id: 1, knowledge_base_id: 1, source_node_id: 1, target_node_id: 2, type: "contains" },
    { id: 2, knowledge_base_id: 1, source_node_id: 2, target_node_id: 3, type: "related" },
    { id: 3, knowledge_base_id: 1, source_node_id: 3, target_node_id: 4, type: "applied_by" },
  ],
};

describe("graphUtils", () => {
  it("computes focused node ids by depth", () => {
    expect(Array.from(focusedNodeIds(graph, 1, 1)).sort()).toEqual([1, 2]);
    expect(Array.from(focusedNodeIds(graph, 1, 2)).sort()).toEqual([1, 2, 3]);
  });

  it("prepares filtered graph data", () => {
    const prepared = prepareGraphData(graph, {
      depth: 2,
      query: "",
      selectedNodeId: 1,
      type: "skill",
      viewMode: "explore",
    });

    expect(prepared.nodes.map((node) => node.name)).toEqual(["重排序"]);
    expect(prepared.edges).toEqual([]);
  });
});
