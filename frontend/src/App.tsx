import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import {
  Activity,
  BookOpen,
  CirclePlus,
  Database,
  Download,
  GitBranch,
  History,
  KeyRound,
  Library,
  Play,
  Save,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";

import {
  collectRun,
  createKnowledgeBase,
  createRun,
  exportKnowledge,
  fetchGraph,
  fetchHealth,
  fetchKnowledgeNode,
  fetchKnowledgeBases,
  fetchModelSettings,
  fetchRunDetail,
  fetchRunCards,
  fetchRunSources,
  fetchRuns,
  fetchSourceSettings,
  importKnowledge,
  saveModelSettings,
  saveSourceSettings,
  type GraphData,
  type HealthResponse,
  type KnowledgeBase,
  type KnowledgeExport,
  type KnowledgeNode,
  type LearningCard,
  type LearningRun,
  type ModelSettings,
  type SourceRecord,
  type SourceSettings,
  type SourceSettingsInput,
} from "./api";

const modes = ["light", "standard", "deep"] as const;
type ViewKey = "learn" | "graph" | "history" | "settings";
type SourceDraft = SourceSettingsInput & { id: number };

const learningCards = [
  {
    type: "基础",
    title: "核心概念",
    body: "定义、术语、前置知识和最短学习路径会沉淀在当前知识库。",
  },
  {
    type: "实践",
    title: "最新项目与技能",
    body: "开源项目、工具链、行业案例和实践技能会保留来源证据。",
  },
  {
    type: "隔离",
    title: "知识库边界",
    body: "不同知识库不会自动互相关联，适合拆分行业、项目或学习方向。",
  },
];

const defaultSources: SourceSettingsInput[] = [
  {
    name: "GitHub repositories",
    type: "builtin",
    enabled: true,
    url_or_domain: "github.com",
    language_hint: "en",
    crawl_depth: 1,
    rate_limit: null,
    extractor_rule: null,
  },
  {
    name: "Juejin search",
    type: "search_page",
    enabled: true,
    url_or_domain: "https://juejin.cn/search?query={keyword}&type=0",
    language_hint: "zh",
    crawl_depth: 1,
    rate_limit: null,
    extractor_rule: null,
  },
  {
    name: "Dev.to search",
    type: "search_page",
    enabled: true,
    url_or_domain: "https://dev.to/search?q={keyword}",
    language_hint: "en",
    crawl_depth: 1,
    rate_limit: null,
    extractor_rule: null,
  },
  {
    name: "Stack Overflow search",
    type: "search_page",
    enabled: true,
    url_or_domain: "https://stackoverflow.com/search?q={keyword}",
    language_hint: "en",
    crawl_depth: 1,
    rate_limit: null,
    extractor_rule: null,
  },
  {
    name: "Hacker News search",
    type: "search_page",
    enabled: true,
    url_or_domain: "https://hn.algolia.com/?q={keyword}",
    language_hint: "en",
    crawl_depth: 1,
    rate_limit: null,
    extractor_rule: null,
  },
  {
    name: "Google News technology RSS",
    type: "rss",
    enabled: true,
    url_or_domain: "https://news.google.com/rss/search?q={keyword}%20technology&hl=en-US&gl=US&ceid=US:en",
    language_hint: "en",
    crawl_depth: 1,
    rate_limit: null,
    extractor_rule: null,
  },
];

const emptyModelForm = {
  name: "Default",
  base_url: "https://api.openai.com/v1",
  model: "gpt-4.1-mini",
  api_key: "",
  default_temperature: 0.2,
  max_tokens: 4096,
};

const navItems: Array<{ key: ViewKey; label: string; icon: typeof BookOpen }> = [
  { key: "learn", label: "Learn", icon: BookOpen },
  { key: "graph", label: "Knowledge graph", icon: Database },
  { key: "history", label: "History", icon: History },
  { key: "settings", label: "Settings", icon: Settings },
];

function App() {
  const [activeView, setActiveView] = useState<ViewKey>("learn");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("AI Agent");
  const [mode, setMode] = useState<(typeof modes)[number]>("light");
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [activeKnowledgeBaseId, setActiveKnowledgeBaseId] = useState<number | null>(null);
  const [newKnowledgeBaseName, setNewKnowledgeBaseName] = useState("");
  const [historyFilter, setHistoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [runs, setRuns] = useState<LearningRun[]>([]);
  const [modelSettings, setModelSettings] = useState<ModelSettings | null>(null);
  const [sources, setSources] = useState<SourceSettings[]>([]);
  const [sourceDrafts, setSourceDrafts] = useState<SourceDraft[]>([]);
  const [runSources, setRunSources] = useState<SourceRecord[]>([]);
  const [cards, setCards] = useState<LearningCard[]>([]);
  const [graph, setGraph] = useState<GraphData>({ nodes: [], edges: [] });
  const [selectedNode, setSelectedNode] = useState<KnowledgeNode | null>(null);
  const [selectedRun, setSelectedRun] = useState<LearningRun | null>(null);
  const [modelForm, setModelForm] = useState(emptyModelForm);
  const [message, setMessage] = useState<string>("Ready");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function loadInitialData() {
      try {
        const [healthData, modelData, sourceData, bases] = await Promise.all([
          fetchHealth(),
          fetchModelSettings(),
          fetchSourceSettings(),
          fetchKnowledgeBases(),
        ]);
        if (!mounted) return;
        const selectedBase = bases[0] ?? null;
        setHealth(healthData);
        setHealthError(null);
        setModelSettings(modelData);
        setSources(sourceData);
        setSourceDrafts(toSourceDrafts(sourceData));
        setKnowledgeBases(bases);
        setActiveKnowledgeBaseId(selectedBase?.id ?? null);
        if (modelData) {
          setModelForm({
            name: modelData.name,
            base_url: modelData.base_url,
            model: modelData.model,
            api_key: "",
            default_temperature: modelData.default_temperature,
            max_tokens: modelData.max_tokens,
          });
        }
      } catch (error) {
        if (!mounted) return;
        setHealth(null);
        setHealthError(error instanceof Error ? error.message : "API unavailable");
      }
    }

    loadInitialData();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    if (!activeKnowledgeBaseId) return;

    async function loadScopedData() {
      try {
        const [runData, graphData] = await Promise.all([
          fetchRuns(activeKnowledgeBaseId),
          fetchGraph(activeKnowledgeBaseId),
        ]);
        if (!mounted) return;
        setRuns(runData);
        setGraph(graphData);
        setRunSources([]);
        setCards([]);
        setSelectedNode(null);
        setSelectedRun(null);
      } catch (error) {
        if (!mounted) return;
        setMessage(error instanceof Error ? error.message : "Failed to load knowledge base data");
      }
    }

    loadScopedData();

    return () => {
      mounted = false;
    };
  }, [activeKnowledgeBaseId]);

  const activeKnowledgeBase = useMemo(
    () => knowledgeBases.find((item) => item.id === activeKnowledgeBaseId) ?? null,
    [activeKnowledgeBaseId, knowledgeBases],
  );

  const sourceRows = useMemo(() => {
    const rows = sources.length > 0 ? sources : defaultSources.map((source, index) => ({ ...source, id: index + 1 }));
    return rows.map((source) => ({
      name: source.name,
      status: source.enabled ? source.type : "disabled",
      tone: source.enabled ? sourceTone(source.type) : "gray",
    }));
  }, [sources]);

  const healthLabel = health ? `API ${health.version}` : healthError ? "API offline" : "Checking";
  const filteredRuns = useMemo(() => {
    const keyword = historyFilter.trim().toLowerCase();
    return runs.filter((run) => {
      const matchesKeyword = !keyword || run.keyword.toLowerCase().includes(keyword);
      const matchesStatus = statusFilter === "all" || run.status === statusFilter;
      return matchesKeyword && matchesStatus;
    });
  }, [historyFilter, runs, statusFilter]);

  async function refreshActiveKnowledgeBase(knowledgeBaseId = activeKnowledgeBaseId) {
    if (!knowledgeBaseId) return;
    const [runData, graphData] = await Promise.all([fetchRuns(knowledgeBaseId), fetchGraph(knowledgeBaseId)]);
    setRuns(runData);
    setGraph(graphData);
  }

  async function handleSaveModel() {
    setBusy(true);
    setMessage("Saving model settings...");
    try {
      const saved = await saveModelSettings({
        ...modelForm,
        api_key: modelForm.api_key || undefined,
      });
      setModelSettings(saved);
      setModelForm((current) => ({ ...current, api_key: "" }));
      setMessage("Model settings saved");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save model settings");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveDefaultSources() {
    setBusy(true);
    setMessage("Saving source settings...");
    try {
      const payload = sourceDrafts.length > 0 ? sourceDrafts.map(toSourceInput) : defaultSources;
      const saved = await saveSourceSettings(payload);
      setSources(saved);
      setSourceDrafts(toSourceDrafts(saved));
      setMessage(`Saved ${saved.length} source settings`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save source settings");
    } finally {
      setBusy(false);
    }
  }

  function handleAddSource() {
    const nextId = Math.min(0, ...sourceDrafts.map((source) => source.id)) - 1;
    setSourceDrafts((current) => [
      ...current,
      {
        id: nextId,
        name: "Custom RSS",
        type: "rss",
        enabled: true,
        url_or_domain: "",
        language_hint: null,
        crawl_depth: 1,
        rate_limit: null,
        extractor_rule: null,
      },
    ]);
  }

  function handleRemoveSource(id: number) {
    setSourceDrafts((current) => current.filter((source) => source.id !== id));
  }

  function handleResetSources() {
    setSourceDrafts(defaultSources.map((source, index) => ({ ...source, id: -(index + 1) })));
  }

  function handleSourceChange(id: number, patch: Partial<SourceDraft>) {
    setSourceDrafts((current) => current.map((source) => (source.id === id ? { ...source, ...patch } : source)));
  }

  async function handleCreateKnowledgeBase() {
    const name = newKnowledgeBaseName.trim();
    if (!name) {
      setMessage("Knowledge base name is required");
      return;
    }
    setBusy(true);
    setMessage("Creating knowledge base...");
    try {
      const created = await createKnowledgeBase(name);
      const bases = await fetchKnowledgeBases();
      setKnowledgeBases(bases);
      setActiveKnowledgeBaseId(created.id);
      setNewKnowledgeBaseName("");
      setActiveView("learn");
      setMessage(`Knowledge base "${created.name}" selected`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to create knowledge base");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateRun() {
    if (!keyword.trim()) {
      setMessage("Keyword is required");
      return;
    }
    if (!activeKnowledgeBaseId) {
      setMessage("Create or select a knowledge base first");
      return;
    }
    setBusy(true);
    setMessage("Creating learning run...");
    try {
      const run = await createRun(keyword.trim(), mode, activeKnowledgeBaseId);
      setRuns((current) => [run, ...current]);
      setMessage(`Run #${run.id} created; collecting sources...`);
      const collected = await collectRun(run.id);
      const collectedSources = await fetchRunSources(run.id);
      const generatedCards = await fetchRunCards(run.id);
      const graphData = await fetchGraph(activeKnowledgeBaseId);
      setRuns((current) => current.map((item) => (item.id === collected.id ? collected : item)));
      setRunSources(collectedSources);
      setCards(generatedCards);
      setGraph(graphData);
      setSelectedRun(collected);
      setMessage(`Run #${run.id} ${collected.status}; ${collectedSources.length} source records`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to create run");
    } finally {
      setBusy(false);
    }
  }

  async function handleExport() {
    setBusy(true);
    setMessage("Exporting knowledge JSON...");
    try {
      const payload = await exportKnowledge(activeKnowledgeBaseId);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${activeKnowledgeBase?.name || "knowledge"}-export-v${payload.version}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage(`Exported ${payload.runs.length} runs and ${payload.nodes.length} nodes`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to export knowledge");
    } finally {
      setBusy(false);
    }
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setMessage("Importing knowledge JSON...");
    try {
      const payload = JSON.parse(await file.text()) as KnowledgeExport;
      const imported = await importKnowledge(payload);
      const bases = await fetchKnowledgeBases();
      setKnowledgeBases(bases);
      const selectedBaseId = activeKnowledgeBaseId ?? bases[0]?.id ?? null;
      setActiveKnowledgeBaseId(selectedBaseId);
      await refreshActiveKnowledgeBase(selectedBaseId);
      setMessage(`Imported ${imported.runs.length} total runs and ${imported.nodes.length} nodes`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to import knowledge");
    } finally {
      event.target.value = "";
      setBusy(false);
    }
  }

  async function handleSelectNode(nodeId: number) {
    if (!activeKnowledgeBaseId) return;
    setMessage("Loading node details...");
    try {
      const node = await fetchKnowledgeNode(nodeId, activeKnowledgeBaseId);
      setSelectedNode(node);
      setMessage(`Node selected: ${node.name}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load node details");
    }
  }

  async function handleSelectRun(runId: number) {
    setMessage("Loading run details...");
    try {
      const detail = await fetchRunDetail(runId);
      setSelectedRun(detail.run);
      setCards(detail.cards);
      setRunSources(detail.sources);
      setMessage(`Loaded run #${detail.run.id}: ${detail.run.keyword}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load run details");
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand-mark">
          <GitBranch aria-hidden="true" size={22} />
        </div>
        <nav className="nav-stack">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                aria-label={item.label}
                className={activeView === item.key ? "nav-button active" : "nav-button"}
                key={item.key}
                onClick={() => setActiveView(item.key)}
                title={item.label}
                type="button"
              >
                <Icon size={18} />
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Local learning workspace</p>
            <h1>AI Learning Knowledge Graph</h1>
          </div>
          <div className="topbar-actions">
            <label className="knowledge-select">
              <Library size={16} aria-hidden="true" />
              <select
                aria-label="Knowledge base"
                disabled={knowledgeBases.length === 0}
                value={activeKnowledgeBaseId ?? ""}
                onChange={(event) => setActiveKnowledgeBaseId(Number(event.target.value))}
              >
                {knowledgeBases.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <div className={health ? "status-pill ready" : "status-pill offline"}>
              <Activity size={15} />
              <span>{healthLabel}</span>
            </div>
          </div>
        </header>

        <p className="message-line" role="status">
          {message}
        </p>

        {activeView === "learn" ? (
          <section className="view-stack" aria-label="Learning workspace">
            <RunPanel
              busy={busy}
              keyword={keyword}
              mode={mode}
              onKeywordChange={setKeyword}
              onModeChange={setMode}
              onRun={handleCreateRun}
              selectedBaseName={activeKnowledgeBase?.name ?? "No knowledge base"}
            />
            <section className="dashboard-grid learn-grid">
              <CardsPanel cards={cards} />
              <ExtractionPanel runSources={runSources} />
              <SourcesPanel
                busy={busy}
                onSaveDefaultSources={handleSaveDefaultSources}
                showSaveAction={false}
                sourceRows={sourceRows}
              />
            </section>
          </section>
        ) : null}

        {activeView === "graph" ? (
          <section className="single-view" aria-label="Knowledge graph workspace">
            <GraphPanel
              graph={graph}
              knowledgeBaseName={activeKnowledgeBase?.name ?? "Current"}
              onSelectNode={handleSelectNode}
              selectedNode={selectedNode}
            />
          </section>
        ) : null}

        {activeView === "history" ? (
          <section className="single-view" aria-label="History workspace">
            <HistoryPanel
              busy={busy}
              filter={historyFilter}
              onExport={handleExport}
              onFilterChange={setHistoryFilter}
              onImport={handleImport}
              onSelectRun={handleSelectRun}
              onStatusChange={setStatusFilter}
              runSources={runSources}
              runs={filteredRuns}
              selectedRun={selectedRun}
              statusFilter={statusFilter}
            />
          </section>
        ) : null}

        {activeView === "settings" ? (
          <section className="dashboard-grid settings-grid" aria-label="Settings workspace">
            <KnowledgeBasePanel
              activeKnowledgeBaseId={activeKnowledgeBaseId}
              busy={busy}
              knowledgeBases={knowledgeBases}
              newKnowledgeBaseName={newKnowledgeBaseName}
              onCreate={handleCreateKnowledgeBase}
              onNameChange={setNewKnowledgeBaseName}
              onSelect={setActiveKnowledgeBaseId}
            />
            <SettingsPanel
              busy={busy}
              modelForm={modelForm}
              modelSettings={modelSettings}
              onModelFormChange={setModelForm}
              onSaveModel={handleSaveModel}
            />
            <SourcesPanel
              busy={busy}
              onAddSource={handleAddSource}
              onRemoveSource={handleRemoveSource}
              onResetSources={handleResetSources}
              onSaveDefaultSources={handleSaveDefaultSources}
              onSourceChange={handleSourceChange}
              sourceDrafts={sourceDrafts}
              showSaveAction
              sourceRows={sourceRows}
            />
          </section>
        ) : null}
      </main>
    </div>
  );
}

type RunPanelProps = {
  busy: boolean;
  keyword: string;
  mode: (typeof modes)[number];
  selectedBaseName: string;
  onKeywordChange: (value: string) => void;
  onModeChange: (value: (typeof modes)[number]) => void;
  onRun: () => void;
};

function RunPanel({
  busy,
  keyword,
  mode,
  selectedBaseName,
  onKeywordChange,
  onModeChange,
  onRun,
}: RunPanelProps) {
  return (
    <section className="run-panel" aria-labelledby="run-title">
      <div className="run-copy">
        <p className="eyebrow">Keyword run</p>
        <h2 id="run-title">新知识采集</h2>
        <small>{selectedBaseName}</small>
      </div>
      <div className="run-controls">
        <label className="keyword-field">
          <Search size={18} aria-hidden="true" />
          <input value={keyword} onChange={(event) => onKeywordChange(event.target.value)} aria-label="Keyword" />
        </label>
        <div className="mode-control" aria-label="Run mode">
          {modes.map((item) => (
            <button
              key={item}
              className={mode === item ? "selected" : ""}
              onClick={() => onModeChange(item)}
              type="button"
            >
              {item}
            </button>
          ))}
        </div>
        <button className="run-button" type="button" onClick={onRun} disabled={busy}>
          <Play size={17} fill="currentColor" />
          <span>Run</span>
        </button>
      </div>
    </section>
  );
}

function CardsPanel({ cards }: { cards: LearningCard[] }) {
  return (
    <div className="panel cards-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Cards</p>
          <h2>学习卡片</h2>
        </div>
        <Sparkles size={19} />
      </div>
      <div className="card-list">
        {(cards.length > 0 ? cards : learningCards).map((card) => (
          <article className="learning-card" key={card.title}>
            <span>{card.type}</span>
            <h3>{card.title}</h3>
            <p>{"summary" in card ? card.summary : card.body}</p>
            {"details" in card && card.details ? <small>{card.details}</small> : null}
          </article>
        ))}
      </div>
    </div>
  );
}

function GraphPanel({
  graph,
  knowledgeBaseName,
  onSelectNode,
  selectedNode,
}: {
  graph: GraphData;
  knowledgeBaseName: string;
  onSelectNode: (nodeId: number) => void;
  selectedNode: KnowledgeNode | null;
}) {
  const sampleNodes = graph.nodes.slice(0, 4);
  const displayNodes =
    sampleNodes.length > 0
      ? sampleNodes.map((node, index) => ({
          className: ["node-keyword", "node-concept", "node-skill", "node-project"][index] ?? "node-concept",
          id: node.id,
          label: node.name,
          type: node.type,
        }))
      : [
          { className: "node-keyword", id: 0, label: knowledgeBaseName, type: "base" },
          { className: "node-concept", id: 0, label: "Foundation", type: "concept" },
          { className: "node-skill", id: 0, label: "Skills", type: "skill" },
          { className: "node-project", id: 0, label: "Projects", type: "project" },
        ];

  return (
    <div className="panel graph-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Graph</p>
          <h2>知识关系</h2>
        </div>
        <GitBranch size={19} />
      </div>
      <div className="graph-summary">
        <span>{graph.nodes.length} nodes</span>
        <span>{graph.edges.length} edges</span>
        <span>{knowledgeBaseName}</span>
      </div>
      <div className="graph-canvas" aria-label="Knowledge graph preview">
        {displayNodes.map((node) => (
          <button
            className={`node ${node.className} ${selectedNode?.id === node.id ? "selected" : ""}`}
            disabled={node.id === 0}
            key={`${node.className}-${node.label}`}
            onClick={() => onSelectNode(node.id)}
            type="button"
          >
            {node.label}
          </button>
        ))}
        <div className="edge edge-a" />
        <div className="edge edge-b" />
        <div className="edge edge-c" />
      </div>
      <div className="node-detail">
        {selectedNode ? (
          <>
            <div>
              <p className="eyebrow">{selectedNode.type}</p>
              <h3>{selectedNode.name}</h3>
            </div>
            <p>{selectedNode.summary || "No summary yet."}</p>
            <div className="tag-row">
              {selectedNode.tags.length === 0 ? <span>No tags</span> : selectedNode.tags.map((tag) => <span key={tag}>{tag}</span>)}
            </div>
          </>
        ) : (
          <p className="empty-state compact">Select a graph node to inspect details.</p>
        )}
      </div>
    </div>
  );
}

function SourcesPanel({
  busy,
  onAddSource,
  onRemoveSource,
  onResetSources,
  showSaveAction = true,
  sourceDrafts = [],
  sourceRows,
  onSaveDefaultSources,
  onSourceChange,
}: {
  busy: boolean;
  onAddSource?: () => void;
  onRemoveSource?: (id: number) => void;
  onResetSources?: () => void;
  showSaveAction?: boolean;
  sourceDrafts?: SourceDraft[];
  sourceRows: Array<{ name: string; status: string; tone: string }>;
  onSaveDefaultSources: () => void;
  onSourceChange?: (id: number, patch: Partial<SourceDraft>) => void;
}) {
  return (
    <div className="panel sources-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Sources</p>
          <h2>来源状态</h2>
        </div>
        {showSaveAction ? (
          <div className="panel-actions">
            <button
              className="icon-action"
              type="button"
              onClick={onResetSources}
              disabled={busy}
              aria-label="Reset source defaults"
              title="Reset source defaults"
            >
              <Database size={18} />
            </button>
            <button
              className="icon-action"
              type="button"
              onClick={onAddSource}
              disabled={busy}
              aria-label="Add source"
              title="Add source"
            >
              <CirclePlus size={18} />
            </button>
            <button
              className="icon-action"
              type="button"
              onClick={onSaveDefaultSources}
              disabled={busy}
              aria-label="Save source settings"
              title="Save source settings"
            >
              <Save size={18} />
            </button>
          </div>
        ) : (
          <Database size={19} />
        )}
      </div>
      {showSaveAction && onSourceChange ? (
        <div className="source-editor-list">
          {sourceDrafts.map((source) => (
            <div className="source-editor-row" key={source.id}>
              <label>
                <span>Name</span>
                <input
                  aria-label={`Source name ${source.id}`}
                  value={source.name}
                  onChange={(event) => onSourceChange(source.id, { name: event.target.value })}
                />
              </label>
              <label>
                <span>Type</span>
                <select
                  aria-label={`Source type ${source.id}`}
                  value={source.type}
                  onChange={(event) => onSourceChange(source.id, { type: event.target.value })}
                >
                  <option value="builtin">builtin</option>
                  <option value="rss">rss</option>
                  <option value="domain">domain</option>
                  <option value="entry_url">entry_url</option>
                  <option value="search_page">search_page</option>
                </select>
              </label>
              <label className="source-url-field">
                <span>URL or domain</span>
                <input
                  aria-label={`Source URL ${source.id}`}
                  value={source.url_or_domain ?? ""}
                  onChange={(event) => onSourceChange(source.id, { url_or_domain: event.target.value })}
                />
              </label>
              <label>
                <span>Lang</span>
                <input
                  aria-label={`Source language ${source.id}`}
                  value={source.language_hint ?? ""}
                  onChange={(event) => onSourceChange(source.id, { language_hint: event.target.value || null })}
                />
              </label>
              <label className="source-enabled">
                <input
                  checked={source.enabled}
                  type="checkbox"
                  onChange={(event) => onSourceChange(source.id, { enabled: event.target.checked })}
                />
                <span>Enabled</span>
              </label>
              <button
                className="icon-action"
                disabled={busy}
                onClick={() => onRemoveSource?.(source.id)}
                type="button"
                aria-label={`Remove ${source.name}`}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="source-list">
          {sourceRows.map((source) => (
            <div className="source-row" key={source.name}>
              <span className={`source-dot ${source.tone}`} />
              <strong>{source.name}</strong>
              <span>{source.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ExtractionPanel({ runSources }: { runSources: SourceRecord[] }) {
  return (
    <div className="panel extracted-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Extraction</p>
          <h2>正文抓取</h2>
        </div>
        <SlidersHorizontal size={19} />
      </div>
      <div className="extracted-list">
        {runSources.length === 0 ? (
          <p className="empty-state">Run a keyword after saving sources.</p>
        ) : (
          runSources.map((source) => (
            <article className="extracted-row" key={source.id}>
              <div>
                <strong>{source.title || source.site || source.url}</strong>
                <a href={source.url} target="_blank" rel="noreferrer">
                  {source.site || source.url}
                </a>
              </div>
              <span className={`extract-status ${source.status}`}>{source.status}</span>
            </article>
          ))
        )}
      </div>
    </div>
  );
}

function SettingsPanel({
  busy,
  modelForm,
  modelSettings,
  onModelFormChange,
  onSaveModel,
}: {
  busy: boolean;
  modelForm: typeof emptyModelForm;
  modelSettings: ModelSettings | null;
  onModelFormChange: (value: typeof emptyModelForm | ((current: typeof emptyModelForm) => typeof emptyModelForm)) => void;
  onSaveModel: () => void;
}) {
  return (
    <div className="panel settings-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Model</p>
          <h2>本地配置</h2>
        </div>
        <KeyRound size={19} />
      </div>
      <div className="settings-form">
        <label>
          <span>Base URL</span>
          <input
            value={modelForm.base_url}
            onChange={(event) => onModelFormChange((current) => ({ ...current, base_url: event.target.value }))}
          />
        </label>
        <label>
          <span>Model</span>
          <input
            value={modelForm.model}
            onChange={(event) => onModelFormChange((current) => ({ ...current, model: event.target.value }))}
          />
        </label>
        <label>
          <span>API Key</span>
          <input
            value={modelForm.api_key}
            placeholder={modelSettings?.api_key_mask ?? "Not saved"}
            onChange={(event) => onModelFormChange((current) => ({ ...current, api_key: event.target.value }))}
          />
        </label>
        <button className="secondary-button" type="button" onClick={onSaveModel} disabled={busy}>
          <Save size={16} />
          <span>Save model</span>
        </button>
      </div>
    </div>
  );
}

function KnowledgeBasePanel({
  activeKnowledgeBaseId,
  busy,
  knowledgeBases,
  newKnowledgeBaseName,
  onCreate,
  onNameChange,
  onSelect,
}: {
  activeKnowledgeBaseId: number | null;
  busy: boolean;
  knowledgeBases: KnowledgeBase[];
  newKnowledgeBaseName: string;
  onCreate: () => void;
  onNameChange: (value: string) => void;
  onSelect: (value: number) => void;
}) {
  return (
    <div className="panel knowledge-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Knowledge bases</p>
          <h2>知识库</h2>
        </div>
        <Library size={19} />
      </div>
      <div className="settings-form">
        <label>
          <span>New knowledge base</span>
          <input
            aria-label="New knowledge base name"
            value={newKnowledgeBaseName}
            onChange={(event) => onNameChange(event.target.value)}
          />
        </label>
        <button className="secondary-button" type="button" onClick={onCreate} disabled={busy}>
          <CirclePlus size={16} />
          <span>Create base</span>
        </button>
      </div>
      <div className="knowledge-list">
        {knowledgeBases.map((item) => (
          <button
            className={item.id === activeKnowledgeBaseId ? "knowledge-row selected" : "knowledge-row"}
            key={item.id}
            onClick={() => onSelect(item.id)}
            type="button"
          >
            <strong>{item.name}</strong>
            <span>{item.description || "No description"}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function HistoryPanel({
  busy,
  filter,
  onFilterChange,
  runs,
  onExport,
  onImport,
  onSelectRun,
  onStatusChange,
  runSources,
  selectedRun,
  statusFilter,
}: {
  busy: boolean;
  filter: string;
  runs: LearningRun[];
  onExport: () => void;
  onFilterChange: (value: string) => void;
  onImport: (event: ChangeEvent<HTMLInputElement>) => void;
  onSelectRun: (runId: number) => void;
  onStatusChange: (value: string) => void;
  runSources: SourceRecord[];
  selectedRun: LearningRun | null;
  statusFilter: string;
}) {
  return (
    <div className="panel history-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">History</p>
          <h2>运行记录</h2>
        </div>
        <div className="panel-actions">
          <button className="icon-action" type="button" onClick={onExport} disabled={busy} aria-label="Export">
            <Download size={17} />
          </button>
          <label className="icon-action file-action" aria-label="Import">
            <Upload size={17} />
            <input type="file" accept="application/json" onChange={onImport} disabled={busy} />
          </label>
        </div>
      </div>
      <div className="history-filters">
        <label>
          <Search size={15} aria-hidden="true" />
          <input
            aria-label="Filter history"
            value={filter}
            onChange={(event) => onFilterChange(event.target.value)}
            placeholder="Filter runs"
          />
        </label>
        <select aria-label="Filter status" value={statusFilter} onChange={(event) => onStatusChange(event.target.value)}>
          <option value="all">all</option>
          <option value="completed">completed</option>
          <option value="partial">partial</option>
          <option value="failed">failed</option>
          <option value="pending">pending</option>
          <option value="running">running</option>
        </select>
      </div>
      <div className="run-list">
        {runs.length === 0 ? (
          <p className="empty-state">No runs yet.</p>
        ) : (
          runs.map((run) => (
            <button className="run-row" key={run.id} onClick={() => onSelectRun(run.id)} type="button">
              <strong>{run.keyword}</strong>
              <span>{run.mode}</span>
              <span>{run.status}</span>
            </button>
          ))
        )}
      </div>
      <div className="history-detail">
        {selectedRun ? (
          <>
            <div className="detail-grid">
              <div>
                <span>Selected</span>
                <strong>{selectedRun.keyword}</strong>
              </div>
              <div>
                <span>Sources</span>
                <strong>{selectedRun.source_count}</strong>
              </div>
              <div>
                <span>Status</span>
                <strong>{selectedRun.status}</strong>
              </div>
            </div>
            <div className="mini-source-list">
              {runSources.slice(0, 5).map((source) => (
                <a href={source.url} key={source.id} target="_blank" rel="noreferrer">
                  <span className={`extract-status ${source.status}`}>{source.status}</span>
                  <strong>{source.title || source.site || source.url}</strong>
                </a>
              ))}
            </div>
          </>
        ) : (
          <p className="empty-state compact">Select a run to review its captured sources.</p>
        )}
      </div>
    </div>
  );
}

function sourceTone(type: string) {
  if (type === "builtin") return "green";
  if (type === "rss") return "blue";
  if (type === "domain") return "amber";
  if (type === "search_page") return "red";
  return "gray";
}

function toSourceDrafts(sourceSettings: SourceSettings[]): SourceDraft[] {
  if (sourceSettings.length === 0) {
    return defaultSources.map((source, index) => ({ ...source, id: -(index + 1) }));
  }
  return sourceSettings.map((source) => ({
    name: source.name,
    type: source.type,
    enabled: source.enabled,
    url_or_domain: source.url_or_domain,
    language_hint: source.language_hint,
    crawl_depth: source.crawl_depth,
    rate_limit: source.rate_limit,
    extractor_rule: source.extractor_rule,
    id: source.id,
  }));
}

function toSourceInput(source: SourceDraft): SourceSettingsInput {
  return {
    name: source.name.trim() || "Untitled source",
    type: source.type,
    enabled: source.enabled,
    url_or_domain: source.url_or_domain?.trim() || null,
    language_hint: source.language_hint?.trim() || null,
    crawl_depth: source.crawl_depth,
    rate_limit: source.rate_limit,
    extractor_rule: source.extractor_rule,
  };
}

export default App;
