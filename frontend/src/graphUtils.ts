import type { GraphData, KnowledgeNode } from "./api";

export type GraphViewMode = "explore" | "types" | "path";

export type PreparedGraphNode = KnowledgeNode & {
  distance: number | null;
  group: string;
  muted: boolean;
  priority: number;
  weight: number;
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
  const semanticNodes = graph.nodes.filter((node) => !isSourceNode(node));
  const semanticIds = new Set(semanticNodes.map((node) => node.id));
  const semanticEdges = graph.edges.filter(
    (edge) =>
      semanticIds.has(edge.source_node_id) &&
      semanticIds.has(edge.target_node_id) &&
      edge.type !== "supported_by_source",
  );
  const semanticGraph = { nodes: semanticNodes, edges: semanticEdges };
  const selectedIds = focusedNodeIds(semanticGraph, filters.selectedNodeId, filters.depth);
  const distances = nodeDistances(semanticGraph, filters.selectedNodeId, filters.depth);
  const degrees = nodeDegrees(semanticGraph);
  const ranked = [...semanticNodes].sort((left, right) => {
    const leftFocus = selectedIds.has(left.id) ? 0 : 1;
    const rightFocus = selectedIds.has(right.id) ? 0 : 1;
    if (leftFocus !== rightFocus) return leftFocus - rightFocus;
    return (degrees.get(right.id) ?? 0) - (degrees.get(left.id) ?? 0) || left.id - right.id;
  });
  const visibleNodes = ranked.filter((node, index) => {
    if (type !== "all" && node.type !== type) return false;
    if (query && !nodeMatchesQuery(node, query)) return false;
    if (filters.selectedNodeId && filters.viewMode === "explore") return selectedIds.has(node.id);
    if (filters.selectedNodeId) return selectedIds.has(node.id);
    if (filters.viewMode === "explore") return query || type !== "all" ? true : index < 64;
    return query || type !== "all" ? true : index < 42;
  });
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = semanticEdges.filter(
    (edge) => visibleIds.has(edge.source_node_id) && visibleIds.has(edge.target_node_id),
  );
  const nodes = orderByView(visibleNodes, filters.viewMode, degrees).map((node, index) => ({
    ...node,
    distance: distances.get(node.id) ?? null,
    group: groupForNode(node, filters.viewMode),
    muted: filters.selectedNodeId !== null && filters.viewMode === "explore" && !selectedIds.has(node.id),
    priority: index,
    weight: degrees.get(node.id) ?? 0,
  }));
  return { nodes, edges: visibleEdges };
}

export function focusedNodeIds(graph: GraphData, selectedNodeId: number | null, depth: number): Set<number> {
  return new Set(nodeDistances(graph, selectedNodeId, depth).keys());
}

export function nodeDistances(graph: GraphData, selectedNodeId: number | null, depth: number): Map<number, number> {
  const distances = new Map<number, number>();
  if (!selectedNodeId) return distances;
  const adjacency = new Map<number, Set<number>>();
  graph.edges.forEach((edge) => {
    if (!adjacency.has(edge.source_node_id)) adjacency.set(edge.source_node_id, new Set());
    if (!adjacency.has(edge.target_node_id)) adjacency.set(edge.target_node_id, new Set());
    adjacency.get(edge.source_node_id)?.add(edge.target_node_id);
    adjacency.get(edge.target_node_id)?.add(edge.source_node_id);
  });
  distances.set(selectedNodeId, 0);
  let frontier = new Set([selectedNodeId]);
  for (let step = 0; step < depth; step += 1) {
    const next = new Set<number>();
    frontier.forEach((nodeId) => {
      adjacency.get(nodeId)?.forEach((neighborId) => {
        if (!distances.has(neighborId)) next.add(neighborId);
      });
    });
    if (next.size === 0) break;
    next.forEach((nodeId) => distances.set(nodeId, step + 1));
    frontier = next;
  }
  return distances;
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
  return Array.from(new Set(graph.nodes.filter((node) => !isSourceNode(node)).map((node) => node.type))).sort();
}

export function isSourceNode(node: KnowledgeNode): boolean {
  return node.type === "source" || node.name.trim().startsWith("来源：");
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
