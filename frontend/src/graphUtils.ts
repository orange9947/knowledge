import type { GraphData, KnowledgeNode } from "./api";

export type GraphViewMode = "explore" | "types" | "path";

export type PreparedGraphNode = KnowledgeNode & {
  group: string;
  priority: number;
};

export type PreparedGraphEdge = GraphData["edges"][number];

export type GraphFilters = {
  depth: number;
  query: string;
  selectedNodeId: number | null;
  type: string;
  viewMode: GraphViewMode;
};

export function prepareGraphData(graph: GraphData, filters: GraphFilters) {
  const query = filters.query.trim().toLowerCase();
  const type = filters.type;
  const selectedIds = focusedNodeIds(graph, filters.selectedNodeId, filters.depth);
  const degrees = nodeDegrees(graph);
  const ranked = [...graph.nodes].sort((left, right) => {
    const leftFocus = selectedIds.has(left.id) ? 0 : 1;
    const rightFocus = selectedIds.has(right.id) ? 0 : 1;
    if (leftFocus !== rightFocus) return leftFocus - rightFocus;
    return (degrees.get(right.id) ?? 0) - (degrees.get(left.id) ?? 0) || left.id - right.id;
  });
  const visibleNodes = ranked.filter((node, index) => {
    if (type !== "all" && node.type !== type) return false;
    if (query && !nodeMatchesQuery(node, query)) return false;
    if (filters.selectedNodeId) return selectedIds.has(node.id);
    return query || type !== "all" ? true : index < 36;
  });
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = graph.edges.filter(
    (edge) => visibleIds.has(edge.source_node_id) && visibleIds.has(edge.target_node_id),
  );
  const nodes = orderByView(visibleNodes, filters.viewMode, degrees).map((node, index) => ({
    ...node,
    group: groupForNode(node, filters.viewMode),
    priority: index,
  }));
  return { nodes, edges: visibleEdges };
}

export function focusedNodeIds(graph: GraphData, selectedNodeId: number | null, depth: number): Set<number> {
  if (!selectedNodeId) return new Set();
  const adjacency = new Map<number, Set<number>>();
  graph.edges.forEach((edge) => {
    if (!adjacency.has(edge.source_node_id)) adjacency.set(edge.source_node_id, new Set());
    if (!adjacency.has(edge.target_node_id)) adjacency.set(edge.target_node_id, new Set());
    adjacency.get(edge.source_node_id)?.add(edge.target_node_id);
    adjacency.get(edge.target_node_id)?.add(edge.source_node_id);
  });
  const visited = new Set([selectedNodeId]);
  let frontier = new Set([selectedNodeId]);
  for (let step = 0; step < depth; step += 1) {
    const next = new Set<number>();
    frontier.forEach((nodeId) => {
      adjacency.get(nodeId)?.forEach((neighborId) => {
        if (!visited.has(neighborId)) next.add(neighborId);
      });
    });
    if (next.size === 0) break;
    next.forEach((nodeId) => visited.add(nodeId));
    frontier = next;
  }
  return visited;
}

export function nodeDegrees(graph: GraphData): Map<number, number> {
  const degrees = new Map<number, number>();
  graph.nodes.forEach((node) => degrees.set(node.id, 0));
  graph.edges.forEach((edge) => {
    degrees.set(edge.source_node_id, (degrees.get(edge.source_node_id) ?? 0) + 1);
    degrees.set(edge.target_node_id, (degrees.get(edge.target_node_id) ?? 0) + 1);
  });
  return degrees;
}

export function graphNodeTypes(graph: GraphData): string[] {
  return Array.from(new Set(graph.nodes.map((node) => node.type))).sort();
}

function nodeMatchesQuery(node: KnowledgeNode, query: string): boolean {
  const text = [node.name, node.summary, node.type, ...node.aliases, ...node.tags].join(" ").toLowerCase();
  return text.includes(query);
}

function orderByView(nodes: KnowledgeNode[], viewMode: GraphViewMode, degrees: Map<number, number>): KnowledgeNode[] {
  if (viewMode === "path") {
    return [...nodes].sort((left, right) => pathOrder(left.type) - pathOrder(right.type) || left.id - right.id);
  }
  if (viewMode === "types") {
    return [...nodes].sort((left, right) => left.type.localeCompare(right.type) || left.id - right.id);
  }
  return [...nodes].sort((left, right) => (degrees.get(right.id) ?? 0) - (degrees.get(left.id) ?? 0) || left.id - right.id);
}

function groupForNode(node: KnowledgeNode, viewMode: GraphViewMode): string {
  if (viewMode === "path") return pathGroup(node.type);
  return node.type;
}

function pathOrder(type: string): number {
  if (type === "keyword") return 0;
  if (type === "concept") return 1;
  if (type === "skill" || type === "tool" || type === "method") return 2;
  if (type === "project") return 3;
  if (type === "source") return 4;
  return 5;
}

function pathGroup(type: string): string {
  if (type === "keyword") return "基础";
  if (type === "concept") return "概念";
  if (type === "skill" || type === "tool" || type === "method") return "方法";
  if (type === "project") return "实践";
  if (type === "source") return "来源";
  return "其他";
}
