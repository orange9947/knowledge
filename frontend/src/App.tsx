import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import {
  Activity,
  BookOpen,
  Database,
  Download,
  GitBranch,
  History,
  Upload,
  KeyRound,
  Play,
  Save,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";

import {
  collectRun,
  createRun,
  exportKnowledge,
  fetchGraph,
  fetchHealth,
  fetchModelSettings,
  fetchRunCards,
  fetchRunSources,
  fetchRuns,
  fetchSourceSettings,
  importKnowledge,
  saveModelSettings,
  saveSourceSettings,
  type HealthResponse,
  type GraphData,
  type KnowledgeExport,
  type LearningCard,
  type LearningRun,
  type ModelSettings,
  type SourceRecord,
  type SourceSettings,
  type SourceSettingsInput,
} from "./api";

const modes = ["light", "standard", "deep"] as const;

const learningCards = [
  {
    type: "基础",
    title: "核心概念",
    body: "定义、术语、前置知识和最短学习路径会沉淀为可复用节点。",
  },
  {
    type: "实践",
    title: "最新项目与技能",
    body: "开源项目、工具链、行业案例和实践技能会保留来源证据。",
  },
  {
    type: "关联",
    title: "历史知识连接",
    body: "新关键词会和旧节点建立同名、别名、标签和来源域名关联。",
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

function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("AI Agent");
  const [mode, setMode] = useState<(typeof modes)[number]>("light");
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
        const [healthData, modelData, sourceData, runData, graphData] = await Promise.all([
          fetchHealth(),
          fetchModelSettings(),
          fetchSourceSettings(),
          fetchRuns(),
          fetchGraph(),
        ]);
        if (!mounted) return;
        setHealth(healthData);
        setHealthError(null);
        setModelSettings(modelData);
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
        setSources(sourceData);
        setRuns(runData);
        setGraph(graphData);
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

  const sourceRows = useMemo(() => {
    const rows = sources.length > 0 ? sources : defaultSources.map((source, index) => ({ ...source, id: index + 1 }));
    return rows.map((source) => ({
      name: source.name,
      status: source.enabled ? source.type : "disabled",
      tone: source.enabled ? sourceTone(source.type) : "gray",
    }));
  }, [sources]);

  const healthLabel = health ? `API ${health.version}` : healthError ? "API offline" : "Checking";

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

  async function handleCreateRun() {
    if (!keyword.trim()) {
      setMessage("Keyword is required");
      return;
    }
    setBusy(true);
    setMessage("Creating learning run...");
    try {
      const run = await createRun(keyword.trim(), mode);
      setRuns((current) => [run, ...current]);
      setMessage(`Run #${run.id} created; collecting sources...`);
      const collected = await collectRun(run.id);
      const collectedSources = await fetchRunSources(run.id);
      const generatedCards = await fetchRunCards(run.id);
      const graphData = await fetchGraph();
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
      const payload = await exportKnowledge();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `knowledge-export-v${payload.version}.json`;
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
      const [runData, graphData] = await Promise.all([fetchRuns(), fetchGraph()]);
      setRuns(runData);
      setGraph(graphData);
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
          <button className="nav-button active" aria-label="Learn">
            <BookOpen size={18} />
          </button>
          <button className="nav-button" aria-label="History">
            <History size={18} />
          </button>
          <button className="nav-button" aria-label="Knowledge graph">
            <Database size={18} />
          </button>
          <button className="nav-button" aria-label="Settings">
            <Settings size={18} />
          </button>
        </nav>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Local learning workspace</p>
            <h1>AI Learning Knowledge Graph</h1>
          </div>
          <div className={health ? "status-pill ready" : "status-pill offline"}>
            <Activity size={15} />
            <span>{healthLabel}</span>
          </div>
        </header>

        <section className="run-panel" aria-labelledby="run-title">
          <div className="run-copy">
            <p className="eyebrow">Keyword run</p>
            <h2 id="run-title">新知识采集</h2>
          </div>
          <div className="run-controls">
            <label className="keyword-field">
              <Search size={18} aria-hidden="true" />
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                aria-label="Keyword"
              />
            </label>
            <div className="mode-control" aria-label="Run mode">
              {modes.map((item) => (
                <button
                  key={item}
                  className={mode === item ? "selected" : ""}
                  onClick={() => setMode(item)}
                  type="button"
                >
                  {item}
                </button>
              ))}
            </div>
            <button className="run-button" type="button" onClick={handleCreateRun} disabled={busy}>
              <Play size={17} fill="currentColor" />
              <span>Run</span>
            </button>
          </div>
        </section>

        <p className="message-line" role="status">
          {message}
        </p>

        <section className="dashboard-grid" aria-label="Learning workspace">
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
            </div>
            <div className="graph-canvas" aria-label="Knowledge graph preview">
              <div className="node node-keyword">AI Agent</div>
              <div className="node node-concept">RAG</div>
              <div className="node node-skill">Tool calling</div>
              <div className="node node-project">AutoGen</div>
              <div className="edge edge-a" />
              <div className="edge edge-b" />
              <div className="edge edge-c" />
            </div>
          </div>

          <div className="panel sources-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Sources</p>
                <h2>来源状态</h2>
              </div>
              <button className="icon-action" type="button" onClick={handleSaveDefaultSources} disabled={busy}>
                <Save size={18} />
              </button>
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
                  onChange={(event) => setModelForm((current) => ({ ...current, base_url: event.target.value }))}
                />
              </label>
              <label>
                <span>Model</span>
                <input
                  value={modelForm.model}
                  onChange={(event) => setModelForm((current) => ({ ...current, model: event.target.value }))}
                />
              </label>
              <label>
                <span>API Key</span>
                <input
                  value={modelForm.api_key}
                  placeholder={modelSettings?.api_key_mask ?? "Not saved"}
                  onChange={(event) => setModelForm((current) => ({ ...current, api_key: event.target.value }))}
                />
              </label>
              <button className="secondary-button" type="button" onClick={handleSaveModel} disabled={busy}>
                <Save size={16} />
                <span>Save model</span>
              </button>
            </div>
          </div>

          <div className="panel history-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">History</p>
                <h2>运行记录</h2>
              </div>
              <div className="panel-actions">
                <button className="icon-action" type="button" onClick={handleExport} disabled={busy} aria-label="Export">
                  <Download size={17} />
                </button>
                <label className="icon-action file-action" aria-label="Import">
                  <Upload size={17} />
                  <input type="file" accept="application/json" onChange={handleImport} disabled={busy} />
                </label>
              </div>
            </div>
            <div className="run-list">
              {runs.length === 0 ? (
                <p className="empty-state">No runs yet.</p>
              ) : (
                runs.slice(0, 5).map((run) => (
                  <div className="run-row" key={run.id}>
                    <strong>{run.keyword}</strong>
                    <span>{run.mode}</span>
                    <span>{run.status}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </main>
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
