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
  Upload,
} from "lucide-react";

import {
  collectRun,
  createKnowledgeBase,
  createRun,
  exportKnowledge,
  fetchGraph,
  fetchHealth,
  fetchKnowledgeBases,
  fetchModelSettings,
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
  type LearningCard,
  type LearningRun,
  type ModelSettings,
  type SourceRecord,
  type SourceSettings,
  type SourceSettingsInput,
} from "./api";

const modes = ["light", "standard", "deep"] as const;
type ViewKey = "learn" | "graph" | "history" | "settings";

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
    name: "GitHub",
    type: "builtin",
    enabled: true,
    url_or_domain: "github.com",
    language_hint: "en",
    crawl_depth: 1,
    rate_limit: null,
    extractor_rule: null,
  },
  {
    name: "RSS feeds",
    type: "rss",
    enabled: true,
    url_or_domain: "",
    language_hint: null,
    crawl_depth: 1,
    rate_limit: null,
    extractor_rule: null,
  },
  {
    name: "Tech community",
    type: "domain",
    enabled: true,
    url_or_domain: "juejin.cn",
    language_hint: "zh",
    crawl_depth: 1,
    rate_limit: null,
    extractor_rule: null,
  },
  {
    name: "Search page",
    type: "search_page",
    enabled: false,
    url_or_domain: "",
    language_hint: null,
    crawl_depth: 0,
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
  const [runs, setRuns] = useState<LearningRun[]>([]);
  const [modelSettings, setModelSettings] = useState<ModelSettings | null>(null);
  const [sources, setSources] = useState<SourceSettings[]>([]);
  const [runSources, setRunSources] = useState<SourceRecord[]>([]);
  const [cards, setCards] = useState<LearningCard[]>([]);
  const [graph, setGraph] = useState<GraphData>({ nodes: [], edges: [] });
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
    setMessage("Saving source defaults...");
    try {
      const saved = await saveSourceSettings(defaultSources);
      setSources(saved);
      setMessage("Source settings saved");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save source settings");
    } finally {
      setBusy(false);
    }
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
            <GraphPanel graph={graph} knowledgeBaseName={activeKnowledgeBase?.name ?? "Current"} />
          </section>
        ) : null}

        {activeView === "history" ? (
          <section className="single-view" aria-label="History workspace">
            <HistoryPanel busy={busy} onExport={handleExport} onImport={handleImport} runs={runs} />
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
              onSaveDefaultSources={handleSaveDefaultSources}
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

function GraphPanel({ graph, knowledgeBaseName }: { graph: GraphData; knowledgeBaseName: string }) {
  const sampleNodes = graph.nodes.slice(0, 4);
  const displayNodes =
    sampleNodes.length > 0
      ? sampleNodes.map((node, index) => ({
          className: ["node-keyword", "node-concept", "node-skill", "node-project"][index] ?? "node-concept",
          label: node.name,
        }))
      : [
          { className: "node-keyword", label: knowledgeBaseName },
          { className: "node-concept", label: "Foundation" },
          { className: "node-skill", label: "Skills" },
          { className: "node-project", label: "Projects" },
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
          <div className={`node ${node.className}`} key={`${node.className}-${node.label}`}>
            {node.label}
          </div>
        ))}
        <div className="edge edge-a" />
        <div className="edge edge-b" />
        <div className="edge edge-c" />
      </div>
    </div>
  );
}

function SourcesPanel({
  busy,
  showSaveAction = true,
  sourceRows,
  onSaveDefaultSources,
}: {
  busy: boolean;
  showSaveAction?: boolean;
  sourceRows: Array<{ name: string; status: string; tone: string }>;
  onSaveDefaultSources: () => void;
}) {
  return (
    <div className="panel sources-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Sources</p>
          <h2>来源状态</h2>
        </div>
        {showSaveAction ? (
          <button
            className="icon-action"
            type="button"
            onClick={onSaveDefaultSources}
            disabled={busy}
            aria-label="Save source defaults"
            title="Save source defaults"
          >
            <Save size={18} />
          </button>
        ) : (
          <Database size={19} />
        )}
      </div>
      <div className="source-list">
        {sourceRows.map((source) => (
          <div className="source-row" key={source.name}>
            <span className={`source-dot ${source.tone}`} />
            <strong>{source.name}</strong>
            <span>{source.status}</span>
          </div>
        ))}
      </div>
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
  runs,
  onExport,
  onImport,
}: {
  busy: boolean;
  runs: LearningRun[];
  onExport: () => void;
  onImport: (event: ChangeEvent<HTMLInputElement>) => void;
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
      <div className="run-list">
        {runs.length === 0 ? (
          <p className="empty-state">No runs yet.</p>
        ) : (
          runs.map((run) => (
            <div className="run-row" key={run.id}>
              <strong>{run.keyword}</strong>
              <span>{run.mode}</span>
              <span>{run.status}</span>
            </div>
          ))
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

export default App;
