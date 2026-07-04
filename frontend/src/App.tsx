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
  Pin,
  PinOff,
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
  clearSourceText,
  collectRun,
  createKnowledgeBase,
  createRun,
  deleteRun,
  deleteSource,
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
  updateRunRetention,
  updateSourceRetention,
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

const modeLabels: Record<string, string> = {
  light: "轻量",
  standard: "标准",
  deep: "深度",
};

const statusLabels: Record<string, string> = {
  all: "全部",
  completed: "已完成",
  disabled: "已停用",
  failed: "失败",
  partial: "部分成功",
  pending: "等待中",
  running: "运行中",
  skipped: "已跳过",
  success: "成功",
};

const typeLabels: Record<string, string> = {
  builtin: "内置",
  domain: "站点",
  entry_url: "入口链接",
  rss: "RSS",
  search_page: "搜索页",
};

const nodeTypeLabels: Record<string, string> = {
  base: "知识库",
  concept: "概念",
  keyword: "关键词",
  project: "项目",
  skill: "技能",
  source: "来源",
  tool: "工具",
};

const cardTypeLabels: Record<string, string> = {
  current_practice: "最新实践",
  foundation: "基础知识",
  learning_path: "学习路径",
  project_tool: "项目工具",
  recommended_reading: "推荐阅读",
  term: "术语",
};

const tagLabels: Record<string, string> = {
  foundation: "基础",
  keyword: "关键词",
  practice: "实践",
  source: "来源",
};

const sourceNameLabels: Record<string, string> = {
  "Dev.to search": "Dev.to 搜索",
  "GitHub repositories": "GitHub 仓库",
  "Google News technology RSS": "Google 新闻技术 RSS",
  "Hacker News search": "Hacker News 搜索",
  "Juejin search": "掘金搜索",
  "Stack Overflow search": "Stack Overflow 搜索",
};

const baseNameLabels: Record<string, string> = {
  Default: "默认知识库",
};

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
    name: "GitHub 仓库",
    type: "builtin",
    enabled: true,
    url_or_domain: "github.com",
    language_hint: "en",
    crawl_depth: 1,
    rate_limit: null,
    extractor_rule: null,
  },
  {
    name: "掘金搜索",
    type: "search_page",
    enabled: true,
    url_or_domain: "https://juejin.cn/search?query={keyword}&type=0",
    language_hint: "zh",
    crawl_depth: 1,
    rate_limit: null,
    extractor_rule: null,
  },
  {
    name: "Dev.to 搜索",
    type: "search_page",
    enabled: true,
    url_or_domain: "https://dev.to/search?q={keyword}",
    language_hint: "en",
    crawl_depth: 1,
    rate_limit: null,
    extractor_rule: null,
  },
  {
    name: "Stack Overflow 搜索",
    type: "search_page",
    enabled: true,
    url_or_domain: "https://stackoverflow.com/search?q={keyword}",
    language_hint: "en",
    crawl_depth: 1,
    rate_limit: null,
    extractor_rule: null,
  },
  {
    name: "Hacker News 搜索",
    type: "search_page",
    enabled: true,
    url_or_domain: "https://hn.algolia.com/?q={keyword}",
    language_hint: "en",
    crawl_depth: 1,
    rate_limit: null,
    extractor_rule: null,
  },
  {
    name: "Google 新闻技术 RSS",
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
  name: "默认配置",
  base_url: "https://api.openai.com/v1",
  model: "gpt-4.1-mini",
  api_key: "",
  default_temperature: 0.2,
  max_tokens: 4096,
};

const navItems: Array<{ key: ViewKey; label: string; icon: typeof BookOpen }> = [
  { key: "learn", label: "学习", icon: BookOpen },
  { key: "graph", label: "知识图谱", icon: Database },
  { key: "history", label: "历史记录", icon: History },
  { key: "settings", label: "设置", icon: Settings },
];

function App() {
  const [activeView, setActiveView] = useState<ViewKey>("learn");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("AI 智能体");
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
  const [message, setMessage] = useState<string>("准备就绪");
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
        setHealthError(error instanceof Error ? error.message : "API 不可用");
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
        setMessage(error instanceof Error ? error.message : "加载知识库数据失败");
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
      name: labelSourceName(source.name),
      status: source.enabled ? labelSourceType(source.type) : statusLabel("disabled"),
      tone: source.enabled ? sourceTone(source.type) : "gray",
    }));
  }, [sources]);

  const healthLabel = health ? `API ${health.version}` : healthError ? "API 离线" : "检查中";
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
    setMessage("正在保存模型设置...");
    try {
      const saved = await saveModelSettings({
        ...modelForm,
        api_key: modelForm.api_key || undefined,
      });
      setModelSettings(saved);
      setModelForm((current) => ({ ...current, api_key: "" }));
      setMessage("模型设置已保存");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存模型设置失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveDefaultSources() {
    setBusy(true);
    setMessage("正在保存来源设置...");
    try {
      const payload = sourceDrafts.length > 0 ? sourceDrafts.map(toSourceInput) : defaultSources;
      const saved = await saveSourceSettings(payload);
      setSources(saved);
      setSourceDrafts(toSourceDrafts(saved));
      setMessage(`已保存 ${saved.length} 个来源设置`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存来源设置失败");
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
        name: "自定义 RSS",
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
      setMessage("请输入知识库名称");
      return;
    }
    setBusy(true);
    setMessage("正在创建知识库...");
    try {
      const created = await createKnowledgeBase(name);
      const bases = await fetchKnowledgeBases();
      setKnowledgeBases(bases);
      setActiveKnowledgeBaseId(created.id);
      setNewKnowledgeBaseName("");
      setActiveView("learn");
      setMessage(`已选择知识库「${created.name}」`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建知识库失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateRun() {
    if (!keyword.trim()) {
      setMessage("请输入关键词");
      return;
    }
    if (!activeKnowledgeBaseId) {
      setMessage("请先创建或选择知识库");
      return;
    }
    setBusy(true);
    setMessage("正在创建学习任务...");
    try {
      const run = await createRun(keyword.trim(), mode, activeKnowledgeBaseId);
      setRuns((current) => [run, ...current]);
      setMessage(`任务 #${run.id} 已创建，正在抓取来源...`);
      const collected = await collectRun(run.id);
      const collectedSources = await fetchRunSources(run.id);
      const generatedCards = await fetchRunCards(run.id);
      const graphData = await fetchGraph(activeKnowledgeBaseId);
      setRuns((current) => current.map((item) => (item.id === collected.id ? collected : item)));
      setRunSources(collectedSources);
      setCards(generatedCards);
      setGraph(graphData);
      setSelectedRun(collected);
      setMessage(`任务 #${run.id} ${statusLabel(collected.status)}；共 ${collectedSources.length} 条来源记录`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建学习任务失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleExport() {
    setBusy(true);
    setMessage("正在导出知识 JSON...");
    try {
      const payload = await exportKnowledge(activeKnowledgeBaseId);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${activeKnowledgeBase?.name || "知识库"}-导出-v${payload.version}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage(`已导出 ${payload.runs.length} 条任务和 ${payload.nodes.length} 个节点`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导出知识失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setMessage("正在导入知识 JSON...");
    try {
      const payload = JSON.parse(await file.text()) as KnowledgeExport;
      const imported = await importKnowledge(payload);
      const bases = await fetchKnowledgeBases();
      setKnowledgeBases(bases);
      const selectedBaseId = activeKnowledgeBaseId ?? bases[0]?.id ?? null;
      setActiveKnowledgeBaseId(selectedBaseId);
      await refreshActiveKnowledgeBase(selectedBaseId);
      setMessage(`导入完成：共 ${imported.runs.length} 条任务、${imported.nodes.length} 个节点`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导入知识失败");
    } finally {
      event.target.value = "";
      setBusy(false);
    }
  }

  async function handleSelectNode(nodeId: number) {
    if (!activeKnowledgeBaseId) return;
    setMessage("正在加载节点详情...");
    try {
      const node = await fetchKnowledgeNode(nodeId, activeKnowledgeBaseId);
      setSelectedNode(node);
      setMessage(`已选择节点：${node.name}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "加载节点详情失败");
    }
  }

  async function handleSelectRun(runId: number) {
    setMessage("正在加载任务详情...");
    try {
      const detail = await fetchRunDetail(runId);
      setSelectedRun(detail.run);
      setCards(detail.cards);
      setRunSources(detail.sources);
      setMessage(`已加载任务 #${detail.run.id}：${detail.run.keyword}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "加载任务详情失败");
    }
  }

  async function handleToggleRunRetention(run: LearningRun) {
    setBusy(true);
    try {
      const updated = await updateRunRetention(run.id, !run.is_pinned);
      setRuns((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      if (selectedRun?.id === updated.id) setSelectedRun(updated);
      setMessage(updated.is_pinned ? `已保留任务 #${updated.id}` : `已取消保留任务 #${updated.id}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "更新任务保留状态失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteRun(run: LearningRun) {
    if (!window.confirm(`确定删除任务「${run.keyword}」及其抓取内容吗？`)) return;
    setBusy(true);
    try {
      await deleteRun(run.id);
      setRuns((current) => current.filter((item) => item.id !== run.id));
      if (selectedRun?.id === run.id) {
        setSelectedRun(null);
        setCards([]);
        setRunSources([]);
      }
      await refreshActiveKnowledgeBase();
      setMessage(`已删除任务 #${run.id}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除任务失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleSourceRetention(source: SourceRecord) {
    setBusy(true);
    try {
      const updated = await updateSourceRetention(source.id, !source.is_pinned);
      setRunSources((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setMessage(updated.is_pinned ? `已保留来源 #${updated.id}` : `已取消保留来源 #${updated.id}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "更新来源保留状态失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleClearSourceText(source: SourceRecord) {
    if (!window.confirm(`确定清空「${source.title || source.site || source.url}」的正文吗？`)) return;
    setBusy(true);
    try {
      const updated = await clearSourceText(source.id);
      setRunSources((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setMessage(`已清空来源 #${updated.id} 的正文`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "清空来源正文失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteSource(source: SourceRecord) {
    if (!window.confirm(`确定从当前任务中删除来源「${source.title || source.site || source.url}」吗？`)) return;
    setBusy(true);
    try {
      await deleteSource(source.id);
      setRunSources((current) => current.filter((item) => item.id !== source.id));
      if (selectedRun) {
        const detail = await fetchRunDetail(selectedRun.id);
        setSelectedRun(detail.run);
        setCards(detail.cards);
        setRunSources(detail.sources);
      }
      await refreshActiveKnowledgeBase();
      setMessage(`已删除来源 #${source.id}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除来源失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="主导航">
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
            <p className="eyebrow">本地学习工作台</p>
            <h1>AI 学习知识图谱</h1>
          </div>
          <div className="topbar-actions">
            <label className="knowledge-select">
              <Library size={16} aria-hidden="true" />
              <select
                aria-label="知识库"
                disabled={knowledgeBases.length === 0}
                value={activeKnowledgeBaseId ?? ""}
                onChange={(event) => setActiveKnowledgeBaseId(Number(event.target.value))}
              >
                {knowledgeBases.map((item) => (
                  <option key={item.id} value={item.id}>
                    {knowledgeBaseName(item)}
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
          <section className="view-stack" aria-label="学习工作区">
            <RunPanel
              busy={busy}
              keyword={keyword}
              mode={mode}
              onKeywordChange={setKeyword}
              onModeChange={setMode}
              onRun={handleCreateRun}
              selectedBaseName={activeKnowledgeBase ? knowledgeBaseName(activeKnowledgeBase) : "未选择知识库"}
            />
            <section className="dashboard-grid learn-grid">
              <CardsPanel cards={cards} />
              <ExtractionPanel
                busy={busy}
                onClearText={handleClearSourceText}
                onDeleteSource={handleDeleteSource}
                onToggleRetention={handleToggleSourceRetention}
                runSources={runSources}
              />
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
          <section className="single-view" aria-label="知识图谱工作区">
            <GraphPanel
              graph={graph}
              knowledgeBaseName={activeKnowledgeBase ? knowledgeBaseName(activeKnowledgeBase) : "当前知识库"}
              onSelectNode={handleSelectNode}
              selectedNode={selectedNode}
            />
          </section>
        ) : null}

        {activeView === "history" ? (
          <section className="single-view" aria-label="历史记录工作区">
            <HistoryPanel
              busy={busy}
              filter={historyFilter}
              onClearText={handleClearSourceText}
              onExport={handleExport}
              onFilterChange={setHistoryFilter}
              onImport={handleImport}
              onDeleteRun={handleDeleteRun}
              onDeleteSource={handleDeleteSource}
              onSelectRun={handleSelectRun}
              onStatusChange={setStatusFilter}
              onToggleSourceRetention={handleToggleSourceRetention}
              onToggleRunRetention={handleToggleRunRetention}
              runSources={runSources}
              runs={filteredRuns}
              selectedRun={selectedRun}
              statusFilter={statusFilter}
            />
          </section>
        ) : null}

        {activeView === "settings" ? (
          <section className="dashboard-grid settings-grid" aria-label="设置工作区">
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
        <p className="eyebrow">关键词任务</p>
        <h2 id="run-title">新知识采集</h2>
        <small>{selectedBaseName}</small>
      </div>
      <div className="run-controls">
        <label className="keyword-field">
          <Search size={18} aria-hidden="true" />
          <input value={keyword} onChange={(event) => onKeywordChange(event.target.value)} aria-label="关键词" />
        </label>
        <div className="mode-control" aria-label="运行模式">
          {modes.map((item) => (
            <button
              key={item}
              className={mode === item ? "selected" : ""}
              onClick={() => onModeChange(item)}
              type="button"
            >
              {modeLabel(item)}
            </button>
          ))}
        </div>
        <button className="run-button" type="button" onClick={onRun} disabled={busy}>
          <Play size={17} fill="currentColor" />
          <span>运行</span>
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
          <p className="eyebrow">学习卡片</p>
          <h2>学习卡片</h2>
        </div>
        <Sparkles size={19} />
      </div>
      <div className="card-list">
        {(cards.length > 0 ? cards : learningCards).map((card) => (
          <article className="learning-card" key={card.title}>
            <span>{cardTypeLabel(card.type)}</span>
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
          { className: "node-concept", id: 0, label: "基础", type: "concept" },
          { className: "node-skill", id: 0, label: "技能", type: "skill" },
          { className: "node-project", id: 0, label: "项目", type: "project" },
        ];

  return (
    <div className="panel graph-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">知识图谱</p>
          <h2>知识关系</h2>
        </div>
        <GitBranch size={19} />
      </div>
      <div className="graph-summary">
        <span>{graph.nodes.length} 个节点</span>
        <span>{graph.edges.length} 条关系</span>
        <span>{knowledgeBaseName}</span>
      </div>
      <div className="graph-canvas" aria-label="知识图谱预览">
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
              <p className="eyebrow">{nodeTypeLabel(selectedNode.type)}</p>
              <h3>{selectedNode.name}</h3>
            </div>
            <p>{selectedNode.summary || "暂无摘要。"}</p>
            <div className="tag-row">
              {selectedNode.tags.length === 0
                ? <span>暂无标签</span>
                : selectedNode.tags.map((tag) => <span key={tag}>{tagLabel(tag)}</span>)}
            </div>
          </>
        ) : (
          <p className="empty-state compact">选择一个图谱节点查看详情。</p>
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
          <p className="eyebrow">学习来源</p>
          <h2>来源状态</h2>
        </div>
        {showSaveAction ? (
          <div className="panel-actions">
            <button
              className="icon-action"
              type="button"
              onClick={onResetSources}
              disabled={busy}
              aria-label="重置默认来源"
              title="重置默认来源"
            >
              <Database size={18} />
            </button>
            <button
              className="icon-action"
              type="button"
              onClick={onAddSource}
              disabled={busy}
              aria-label="新增来源"
              title="新增来源"
            >
              <CirclePlus size={18} />
            </button>
            <button
              className="icon-action"
              type="button"
              onClick={onSaveDefaultSources}
              disabled={busy}
              aria-label="保存来源设置"
              title="保存来源设置"
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
                <span>名称</span>
                <input
                  aria-label={`来源名称 ${source.id}`}
                  value={source.name}
                  onChange={(event) => onSourceChange(source.id, { name: event.target.value })}
                />
              </label>
              <label>
                <span>类型</span>
                <select
                  aria-label={`来源类型 ${source.id}`}
                  value={source.type}
                  onChange={(event) => onSourceChange(source.id, { type: event.target.value })}
                >
                  <option value="builtin">内置</option>
                  <option value="rss">RSS</option>
                  <option value="domain">站点</option>
                  <option value="entry_url">入口链接</option>
                  <option value="search_page">搜索页</option>
                </select>
              </label>
              <label className="source-url-field">
                <span>URL 或域名</span>
                <input
                  aria-label={`来源 URL ${source.id}`}
                  value={source.url_or_domain ?? ""}
                  onChange={(event) => onSourceChange(source.id, { url_or_domain: event.target.value })}
                />
              </label>
              <label>
                <span>语言</span>
                <input
                  aria-label={`来源语言 ${source.id}`}
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
                <span>启用</span>
              </label>
              <button
                className="icon-action"
                disabled={busy}
                onClick={() => onRemoveSource?.(source.id)}
                type="button"
                aria-label={`移除 ${source.name}`}
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

function ExtractionPanel({
  busy,
  onClearText,
  onDeleteSource,
  onToggleRetention,
  runSources,
}: {
  busy: boolean;
  onClearText: (source: SourceRecord) => void;
  onDeleteSource: (source: SourceRecord) => void;
  onToggleRetention: (source: SourceRecord) => void;
  runSources: SourceRecord[];
}) {
  return (
    <div className="panel extracted-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">正文抓取</p>
          <h2>正文抓取</h2>
        </div>
        <SlidersHorizontal size={19} />
      </div>
      <div className="extracted-list">
        {runSources.length === 0 ? (
          <p className="empty-state">保存来源后运行关键词任务。</p>
        ) : (
          runSources.map((source) => (
            <article className="extracted-row" key={source.id}>
              <div>
                <strong>{source.title || source.site || source.url}</strong>
                <a href={source.url} target="_blank" rel="noreferrer">
                  {source.site || source.url}
                </a>
              </div>
              <span className={`extract-status ${source.status}`}>{statusLabel(source.status)}</span>
              <div className="row-actions">
                <button
                  aria-label={source.is_pinned ? `取消保留来源 ${source.id}` : `保留来源 ${source.id}`}
                  className="icon-action"
                  disabled={busy}
                  onClick={() => onToggleRetention(source)}
                  title={source.is_pinned ? "取消保留来源" : "保留来源"}
                  type="button"
                >
                  {source.is_pinned ? <PinOff size={15} /> : <Pin size={15} />}
                </button>
                <button
                  aria-label={`清空正文 ${source.id}`}
                  className="icon-action"
                  disabled={busy || !source.extracted_text}
                  onClick={() => onClearText(source)}
                  title="清空抓取正文"
                  type="button"
                >
                  <SlidersHorizontal size={15} />
                </button>
                <button
                  aria-label={`删除来源 ${source.id}`}
                  className="icon-action danger"
                  disabled={busy}
                  onClick={() => onDeleteSource(source)}
                  title="删除来源"
                  type="button"
                >
                  <Trash2 size={15} />
                </button>
              </div>
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
          <p className="eyebrow">模型</p>
          <h2>本地配置</h2>
        </div>
        <KeyRound size={19} />
      </div>
      <div className="settings-form">
        <label>
          <span>接口地址</span>
          <input
            value={modelForm.base_url}
            onChange={(event) => onModelFormChange((current) => ({ ...current, base_url: event.target.value }))}
          />
        </label>
        <label>
          <span>模型名称</span>
          <input
            value={modelForm.model}
            onChange={(event) => onModelFormChange((current) => ({ ...current, model: event.target.value }))}
          />
        </label>
        <label>
          <span>API 密钥</span>
          <input
            value={modelForm.api_key}
            placeholder={modelSettings?.api_key_mask ?? "未保存"}
            onChange={(event) => onModelFormChange((current) => ({ ...current, api_key: event.target.value }))}
          />
        </label>
        <button className="secondary-button" type="button" onClick={onSaveModel} disabled={busy}>
          <Save size={16} />
          <span>保存模型</span>
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
          <p className="eyebrow">知识库</p>
          <h2>知识库</h2>
        </div>
        <Library size={19} />
      </div>
      <div className="settings-form">
        <label>
          <span>新建知识库</span>
          <input
            aria-label="新知识库名称"
            value={newKnowledgeBaseName}
            onChange={(event) => onNameChange(event.target.value)}
          />
        </label>
        <button className="secondary-button" type="button" onClick={onCreate} disabled={busy}>
          <CirclePlus size={16} />
          <span>创建知识库</span>
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
            <strong>{knowledgeBaseName(item)}</strong>
            <span>{item.description || "暂无描述"}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function HistoryPanel({
  busy,
  filter,
  onClearText,
  onDeleteRun,
  onFilterChange,
  runs,
  onExport,
  onImport,
  onDeleteSource,
  onSelectRun,
  onStatusChange,
  onToggleSourceRetention,
  onToggleRunRetention,
  runSources,
  selectedRun,
  statusFilter,
}: {
  busy: boolean;
  filter: string;
  runs: LearningRun[];
  onClearText: (source: SourceRecord) => void;
  onDeleteRun: (run: LearningRun) => void;
  onExport: () => void;
  onFilterChange: (value: string) => void;
  onImport: (event: ChangeEvent<HTMLInputElement>) => void;
  onDeleteSource: (source: SourceRecord) => void;
  onSelectRun: (runId: number) => void;
  onStatusChange: (value: string) => void;
  onToggleSourceRetention: (source: SourceRecord) => void;
  onToggleRunRetention: (run: LearningRun) => void;
  runSources: SourceRecord[];
  selectedRun: LearningRun | null;
  statusFilter: string;
}) {
  return (
    <div className="panel history-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">历史记录</p>
          <h2>运行记录</h2>
        </div>
        <div className="panel-actions">
          <button className="icon-action" type="button" onClick={onExport} disabled={busy} aria-label="导出">
            <Download size={17} />
          </button>
          <label className="icon-action file-action" aria-label="导入">
            <Upload size={17} />
            <input type="file" accept="application/json" onChange={onImport} disabled={busy} />
          </label>
        </div>
      </div>
      <div className="history-filters">
        <label>
          <Search size={15} aria-hidden="true" />
          <input
            aria-label="筛选历史记录"
            value={filter}
            onChange={(event) => onFilterChange(event.target.value)}
            placeholder="筛选任务"
          />
        </label>
        <select aria-label="筛选状态" value={statusFilter} onChange={(event) => onStatusChange(event.target.value)}>
          <option value="all">全部</option>
          <option value="completed">已完成</option>
          <option value="partial">部分成功</option>
          <option value="failed">失败</option>
          <option value="pending">等待中</option>
          <option value="running">运行中</option>
        </select>
      </div>
      <div className="run-list">
        {runs.length === 0 ? (
          <p className="empty-state">暂无任务记录。</p>
        ) : (
          runs.map((run) => (
            <div className="run-row" key={run.id}>
              <button className="run-select" onClick={() => onSelectRun(run.id)} type="button">
                <strong>{run.keyword}</strong>
                <span>{modeLabel(run.mode)}</span>
                <span>{statusLabel(run.status)}</span>
              </button>
              <div className="row-actions">
                <button
                  aria-label={run.is_pinned ? `取消保留任务 ${run.id}` : `保留任务 ${run.id}`}
                  className="icon-action"
                  disabled={busy}
                  onClick={() => onToggleRunRetention(run)}
                  title={run.is_pinned ? "取消保留任务" : "保留任务"}
                  type="button"
                >
                  {run.is_pinned ? <PinOff size={15} /> : <Pin size={15} />}
                </button>
                <button
                  aria-label={`删除任务 ${run.id}`}
                  className="icon-action danger"
                  disabled={busy}
                  onClick={() => onDeleteRun(run)}
                  title="删除任务"
                  type="button"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="history-detail">
        {selectedRun ? (
          <>
            <div className="detail-grid">
              <div>
                <span>已选任务</span>
                <strong>{selectedRun.keyword}</strong>
              </div>
              <div>
                <span>来源数</span>
                <strong>{selectedRun.source_count}</strong>
              </div>
              <div>
                <span>状态</span>
                <strong>{statusLabel(selectedRun.status)}</strong>
              </div>
            </div>
            <div className="mini-source-list">
              {runSources.slice(0, 5).map((source) => (
                <div className="mini-source-row" key={source.id}>
                  <a href={source.url} target="_blank" rel="noreferrer">
                    <span className={`extract-status ${source.status}`}>{statusLabel(source.status)}</span>
                    <strong>{source.title || source.site || source.url}</strong>
                  </a>
                  <div className="row-actions">
                    <button
                      aria-label={source.is_pinned ? `取消保留来源 ${source.id}` : `保留来源 ${source.id}`}
                      className="icon-action"
                      disabled={busy}
                      onClick={() => onToggleSourceRetention(source)}
                      title={source.is_pinned ? "取消保留来源" : "保留来源"}
                      type="button"
                    >
                      {source.is_pinned ? <PinOff size={15} /> : <Pin size={15} />}
                    </button>
                    <button
                      aria-label={`清空正文 ${source.id}`}
                      className="icon-action"
                      disabled={busy || !source.extracted_text}
                      onClick={() => onClearText(source)}
                      title="清空抓取正文"
                      type="button"
                    >
                      <SlidersHorizontal size={15} />
                    </button>
                    <button
                      aria-label={`删除来源 ${source.id}`}
                      className="icon-action danger"
                      disabled={busy}
                      onClick={() => onDeleteSource(source)}
                      title="删除来源"
                      type="button"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="empty-state compact">选择一个任务查看抓取来源。</p>
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

function modeLabel(mode: string) {
  return modeLabels[mode] ?? mode;
}

function statusLabel(status: string) {
  return statusLabels[status] ?? status;
}

function labelSourceType(type: string) {
  return typeLabels[type] ?? type;
}

function labelSourceName(name: string) {
  return sourceNameLabels[name] ?? name;
}

function nodeTypeLabel(type: string) {
  return nodeTypeLabels[type] ?? type;
}

function cardTypeLabel(type: string) {
  return cardTypeLabels[type] ?? type;
}

function tagLabel(tag: string) {
  return tagLabels[tag] ?? tag;
}

function knowledgeBaseName(base: KnowledgeBase) {
  return baseNameLabels[base.name] ?? base.name;
}

function toSourceDrafts(sourceSettings: SourceSettings[]): SourceDraft[] {
  if (sourceSettings.length === 0) {
    return defaultSources.map((source, index) => ({ ...source, id: -(index + 1) }));
  }
  return sourceSettings.map((source) => ({
    name: labelSourceName(source.name),
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
    name: source.name.trim() || "未命名来源",
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
