import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { Graph } from "@antv/g6";
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
  MessageSquareText,
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
  X,
} from "lucide-react";

import {
  aiCollectRun,
  approveRunCards,
  clearSourceText,
  collectRun,
  createKnowledgeBase,
  createKnowledgeNode,
  createRun,
  deleteKnowledgeBase,
  deleteKnowledgeNode,
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
  queryAssistant,
  saveModelSettings,
  saveSourceSettings,
  summarizeRun,
  testModelConnection,
  updateKnowledgeBase,
  updateKnowledgeNode,
  updateRunRetention,
  updateSourceRetention,
  type AssistantResponse,
  type GraphData,
  type HealthResponse,
  type KnowledgeBase,
  type KnowledgeExport,
  type KnowledgeNode,
  type KnowledgeNodeInput,
  type KnowledgeNodeUpdate,
  type LearningCard,
  type LearningRun,
  type ModelSettings,
  type ModelSettingsInput,
  type SourceRecord,
  type SourceSettings,
  type SourceSettingsInput,
} from "./api";
import { graphNodeTypes, prepareGraphData, type GraphViewMode, type PreparedGraphNode } from "./graphUtils";

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
  method: "方法",
  project: "项目",
  skill: "技能",
  source: "来源",
  tool: "工具",
};

const cardTypeLabels: Record<string, string> = {
  current_practice: "最新实践",
  foundation: "基础知识",
  key_point: "核心知识点",
  learning_path: "学习路径",
  practice_project: "实践项目",
  project_tool: "项目工具",
  recommended_reading: "推荐阅读",
  keyword_hint: "关键词提示",
  summary: "总结",
  term: "术语",
  usage_method: "使用方法",
};

const tagLabels: Record<string, string> = {
  foundation: "基础",
  key_point: "知识点",
  keyword: "关键词",
  practice: "实践",
  source: "来源",
  usage: "使用方法",
  keyword_hint: "关键词提示",
};

const sourceNameLabels: Record<string, string> = {
  "Dev.to search": "Dev.to 搜索",
  "GitHub repositories": "GitHub 仓库",
  "Google News technology RSS": "Google 新闻技术 RSS",
  "Hacker News search": "Hacker News 搜索",
  "InfoQ China search": "InfoQ 中文搜索",
  "Juejin search": "掘金搜索",
  "Medium search": "Medium 搜索",
  "Reddit search": "Reddit 搜索",
  "Sspai search": "少数派搜索",
  "Stack Overflow search": "Stack Overflow 搜索",
  "Tencent Cloud Developer search": "腾讯云开发者搜索",
  "Zhihu search": "知乎搜索",
};

const baseNameLabels: Record<string, string> = {
  Default: "默认知识库",
};

const learningCards = [
  {
    type: "核心知识点",
    title: "等待阅读分析",
    body: "运行后，模型会阅读抓取到的文章正文，提炼真正有学习价值的知识点。",
  },
  {
    type: "使用方法",
    title: "方法与场景",
    body: "分析结果会优先整理怎么用、适合什么场景、有哪些步骤和注意事项。",
  },
  {
    type: "学习路径",
    title: "学习路线",
    body: "系统会把知识点、使用方法和实践项目组织成可执行的学习路径。",
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
    name: "知乎搜索",
    type: "search_page",
    enabled: true,
    url_or_domain: "https://www.zhihu.com/search?type=content&q={keyword}",
    language_hint: "zh",
    crawl_depth: 1,
    rate_limit: null,
    extractor_rule: null,
  },
  {
    name: "少数派搜索",
    type: "search_page",
    enabled: true,
    url_or_domain: "https://sspai.com/search/post/{keyword}",
    language_hint: "zh",
    crawl_depth: 1,
    rate_limit: null,
    extractor_rule: null,
  },
  {
    name: "InfoQ 中文搜索",
    type: "search_page",
    enabled: true,
    url_or_domain: "https://www.infoq.cn/search?keyword={keyword}",
    language_hint: "zh",
    crawl_depth: 1,
    rate_limit: null,
    extractor_rule: null,
  },
  {
    name: "CSDN 搜索",
    type: "search_page",
    enabled: true,
    url_or_domain: "https://so.csdn.net/so/search?q={keyword}",
    language_hint: "zh",
    crawl_depth: 1,
    rate_limit: null,
    extractor_rule: null,
  },
  {
    name: "腾讯云开发者搜索",
    type: "search_page",
    enabled: true,
    url_or_domain: "https://cloud.tencent.com/developer/search/article-{keyword}",
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
    name: "Medium 搜索",
    type: "search_page",
    enabled: true,
    url_or_domain: "https://medium.com/search?q={keyword}",
    language_hint: "en",
    crawl_depth: 1,
    rate_limit: null,
    extractor_rule: null,
  },
  {
    name: "Reddit 搜索",
    type: "search_page",
    enabled: true,
    url_or_domain: "https://www.reddit.com/search/?q={keyword}",
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
type ModelFormState = typeof emptyModelForm;

const nodeTypeOptions = ["keyword", "concept", "skill", "project", "tool", "method"] as const;
const emptyNodeForm = {
  name: "",
  type: "concept",
  summary: "",
  aliasesText: "",
  tagsText: "",
};
type NodeFormState = typeof emptyNodeForm;

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
  const [knowledgeBasePrompt, setKnowledgeBasePrompt] = useState("");
  const [runPrompt, setRunPrompt] = useState("");
  const [selectedCardIds, setSelectedCardIds] = useState<number[]>([]);
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
  const [nodeForm, setNodeForm] = useState<NodeFormState>(emptyNodeForm);
  const [isEditingNode, setIsEditingNode] = useState(false);
  const [selectedRun, setSelectedRun] = useState<LearningRun | null>(null);
  const [modelForm, setModelForm] = useState(emptyModelForm);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantQuestion, setAssistantQuestion] = useState("");
  const [assistantAllowWeb, setAssistantAllowWeb] = useState(true);
  const [assistantCreateCandidates, setAssistantCreateCandidates] = useState(true);
  const [assistantResponse, setAssistantResponse] = useState<AssistantResponse | null>(null);
  const [assistantSelectedCardIds, setAssistantSelectedCardIds] = useState<number[]>([]);
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
        setSelectedCardIds([]);
        setKnowledgeBasePrompt(knowledgeBases.find((item) => item.id === activeKnowledgeBaseId)?.learning_prompt ?? "");
        setSelectedNode(null);
        setNodeForm(emptyNodeForm);
        setIsEditingNode(false);
        setSelectedRun(null);
        setAssistantResponse(null);
        setAssistantSelectedCardIds([]);
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

  useEffect(() => {
    setKnowledgeBasePrompt(activeKnowledgeBase?.learning_prompt ?? "");
  }, [activeKnowledgeBase?.id, activeKnowledgeBase?.learning_prompt]);

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
    syncSelectedNodeFromGraph(graphData);
  }

  async function refreshRunAnalysis(run: LearningRun, knowledgeBaseId = activeKnowledgeBaseId) {
    if (!knowledgeBaseId) return;
    const [collectedSources, generatedCards, graphData] = await Promise.all([
      fetchRunSources(run.id),
      fetchRunCards(run.id),
      fetchGraph(knowledgeBaseId),
    ]);
    setRuns((current) => current.map((item) => (item.id === run.id ? run : item)));
    setRunSources(collectedSources);
    setCards(generatedCards);
    setSelectedCardIds((current) => current.filter((id) => generatedCards.some((card) => card.id === id)));
    setGraph(graphData);
    syncSelectedNodeFromGraph(graphData);
    setSelectedRun(run);
  }

  function syncSelectedNodeFromGraph(graphData: GraphData) {
    if (!selectedNode) return;
    const refreshedNode = graphData.nodes.find((node) => node.id === selectedNode.id) ?? null;
    setSelectedNode(refreshedNode);
    setNodeForm(refreshedNode ? nodeToForm(refreshedNode) : emptyNodeForm);
    if (!refreshedNode) setIsEditingNode(false);
  }

  async function handleSaveModel() {
    setBusy(true);
    setMessage("正在保存模型设置...");
    try {
      const saved = await saveModelSettings(toModelInput(modelForm));
      setModelSettings(saved);
      setModelForm((current) => ({ ...current, api_key: "" }));
      setMessage("模型设置已保存");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存模型设置失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleTestModel() {
    setBusy(true);
    setMessage("正在测试模型连接...");
    try {
      const result = await testModelConnection(toModelInput(modelForm));
      const latency = result.latency_ms === null ? "" : `（${result.latency_ms}ms）`;
      setMessage(`${result.message}${latency}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "测试模型连接失败");
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

  async function handleSaveKnowledgePrompt() {
    if (!activeKnowledgeBaseId) {
      setMessage("请先创建或选择知识库");
      return;
    }
    setBusy(true);
    setMessage("正在保存学习偏好...");
    try {
      const updated = await updateKnowledgeBase(activeKnowledgeBaseId, {
        learning_prompt: knowledgeBasePrompt.trim() || null,
      });
      setKnowledgeBases((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setKnowledgeBasePrompt(updated.learning_prompt ?? "");
      setMessage("学习偏好已保存");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存学习偏好失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteKnowledgeBase(base: KnowledgeBase) {
    if (!window.confirm(`确定删除知识库「${knowledgeBaseName(base)}」及其全部任务、来源和图谱吗？`)) return;
    setBusy(true);
    try {
      await deleteKnowledgeBase(base.id);
      const bases = await fetchKnowledgeBases();
      const nextBaseId = bases[0]?.id ?? null;
      setKnowledgeBases(bases);
      setActiveKnowledgeBaseId(nextBaseId);
      setCards([]);
      setRunSources([]);
      setSelectedNode(null);
      setSelectedRun(null);
      if (nextBaseId) {
        await refreshActiveKnowledgeBase(nextBaseId);
      } else {
        setRuns([]);
        setGraph({ nodes: [], edges: [] });
      }
      setMessage(`已删除知识库「${knowledgeBaseName(base)}」`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除知识库失败");
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
      const run = await createRun(keyword.trim(), mode, activeKnowledgeBaseId, runPrompt);
      setRuns((current) => [run, ...current]);
      setMessage(`任务 #${run.id} 已创建，正在抓取来源...`);
      const collected = await collectRun(run.id);
      await refreshRunAnalysis(collected, activeKnowledgeBaseId);
      const collectedSources = await fetchRunSources(run.id);
      const generatedCards = await fetchRunCards(run.id);
      const analysisMode = analysisModeLabel(generatedCards, modelSettings);
      setMessage(`任务 #${run.id} ${statusLabel(collected.status)}；${analysisMode}，素材来源 ${collectedSources.length} 条`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建学习任务失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleAiCollectRun() {
    if (!keyword.trim()) {
      setMessage("请输入关键词");
      return;
    }
    if (!activeKnowledgeBaseId) {
      setMessage("请先创建或选择知识库");
      return;
    }
    setBusy(true);
    setMessage("正在创建 AI 采集任务...");
    try {
      const run = await createRun(keyword.trim(), mode, activeKnowledgeBaseId, runPrompt);
      setRuns((current) => [run, ...current]);
      setMessage(`任务 #${run.id} 已创建，AI 正在筛选采集目标...`);
      const collected = await aiCollectRun(run.id);
      await refreshRunAnalysis(collected, activeKnowledgeBaseId);
      const collectedSources = await fetchRunSources(run.id);
      const generatedCards = await fetchRunCards(run.id);
      setMessage(`任务 #${run.id} ${statusLabel(collected.status)}；AI 采集并总结，素材来源 ${collectedSources.length} 条，卡片 ${generatedCards.length} 张`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "AI 采集失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleApproveSelectedCards() {
    if (!selectedRun) {
      setMessage("请先选择一个任务");
      return;
    }
    if (selectedCardIds.length === 0) {
      setMessage("请选择要加入图谱的知识卡片");
      return;
    }
    setBusy(true);
    setMessage(`正在将 ${selectedCardIds.length} 张知识卡片加入图谱...`);
    try {
      const updated = await approveRunCards(selectedRun.id, selectedCardIds);
      await refreshRunAnalysis(updated, activeKnowledgeBaseId);
      setSelectedCardIds([]);
      setMessage(`已将 ${selectedCardIds.length} 张知识卡片加入图谱`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "加入图谱失败");
    } finally {
      setBusy(false);
    }
  }

  function handleToggleCardSelection(cardId: number, selected: boolean) {
    setSelectedCardIds((current) => {
      if (selected) return current.includes(cardId) ? current : [...current, cardId];
      return current.filter((id) => id !== cardId);
    });
  }

  function handleSelectAllCandidateCards() {
    const candidateIds = cards.filter((card) => card.approval_status === "candidate").map((card) => card.id);
    setSelectedCardIds(candidateIds);
    setMessage(candidateIds.length === 0 ? "没有待加入图谱的卡片" : `已选择 ${candidateIds.length} 张待加入卡片`);
  }

  async function handleSummarizeRun() {
    if (!selectedRun) {
      setMessage("请先运行或选择一个任务");
      return;
    }
    setBusy(true);
    setMessage(`正在总结任务 #${selectedRun.id} 的素材...`);
    try {
      const updated = await summarizeRun(selectedRun.id);
      await refreshRunAnalysis(updated, activeKnowledgeBaseId);
      const generatedCards = await fetchRunCards(updated.id);
      setMessage(`任务 #${updated.id} 已完成总结；阅读分析 ${generatedCards.length} 张卡片`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "总结本次素材失败");
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
      setNodeForm(nodeToForm(node));
      setIsEditingNode(false);
      setMessage(`已选择节点：${node.name}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "加载节点详情失败");
    }
  }

  function handleStartNewNode() {
    setSelectedNode(null);
    setNodeForm(emptyNodeForm);
    setIsEditingNode(true);
    setMessage("正在新建关键点");
  }

  function handleEditNode() {
    if (!selectedNode) return;
    setNodeForm(nodeToForm(selectedNode));
    setIsEditingNode(true);
  }

  function handleCancelNodeEdit() {
    setNodeForm(selectedNode ? nodeToForm(selectedNode) : emptyNodeForm);
    setIsEditingNode(false);
  }

  function handleNodeFormChange(patch: Partial<NodeFormState>) {
    setNodeForm((current) => ({ ...current, ...patch }));
  }

  async function handleSaveNode() {
    if (!activeKnowledgeBaseId) {
      setMessage("请先创建或选择知识库");
      return;
    }
    if (!nodeForm.name.trim()) {
      setMessage("请输入关键点名称");
      return;
    }
    const editingNode = selectedNode;
    setBusy(true);
    setMessage(editingNode ? "正在保存关键点..." : "正在创建关键点...");
    try {
      const payload = nodeFormToPayload(nodeForm);
      const saved = editingNode
        ? await updateKnowledgeNode(editingNode.id, payload, activeKnowledgeBaseId)
        : await createKnowledgeNode(nodeFormToInput(nodeForm, activeKnowledgeBaseId));
      const graphData = await fetchGraph(activeKnowledgeBaseId);
      const refreshedNode = graphData.nodes.find((node) => node.id === saved.id) ?? saved;
      setGraph(graphData);
      setSelectedNode(refreshedNode);
      setNodeForm(nodeToForm(refreshedNode));
      setIsEditingNode(false);
      setMessage(editingNode ? `已更新关键点：${saved.name}` : `已创建关键点：${saved.name}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存关键点失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteNode() {
    if (!selectedNode || !activeKnowledgeBaseId) return;
    const node = selectedNode;
    if (!window.confirm(`确定删除关键点「${node.name}」及其相关关系吗？`)) return;
    setBusy(true);
    setMessage("正在删除关键点...");
    try {
      await deleteKnowledgeNode(node.id, activeKnowledgeBaseId);
      const graphData = await fetchGraph(activeKnowledgeBaseId);
      setGraph(graphData);
      setSelectedNode(null);
      setNodeForm(emptyNodeForm);
      setIsEditingNode(false);
      setMessage(`已删除关键点：${node.name}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除关键点失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleAskAssistant() {
    if (!activeKnowledgeBaseId) {
      setMessage("请先创建或选择知识库");
      return;
    }
    const question = assistantQuestion.trim();
    if (!question) {
      setMessage("请输入要问 AI 助手的问题");
      return;
    }
    setBusy(true);
    setMessage(assistantAllowWeb ? "AI 助手正在检索图谱并联网补充..." : "AI 助手正在检索图谱...");
    try {
      const response = await queryAssistant({
        knowledge_base_id: activeKnowledgeBaseId,
        question,
        selected_node_id: selectedNode?.id ?? null,
        allow_web: assistantAllowWeb,
        create_candidates: assistantCreateCandidates,
      });
      setAssistantResponse(response);
      setAssistantSelectedCardIds([]);
      setMessage(
        response.candidate_cards.length > 0
          ? `AI 助手已回答，并生成 ${response.candidate_cards.length} 张候选卡片`
          : "AI 助手已回答",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "AI 助手请求失败");
    } finally {
      setBusy(false);
    }
  }

  function handleToggleAssistantCandidate(cardId: number, selected: boolean) {
    setAssistantSelectedCardIds((current) => {
      if (selected) return current.includes(cardId) ? current : [...current, cardId];
      return current.filter((id) => id !== cardId);
    });
  }

  async function handleApproveAssistantCandidates() {
    if (!assistantResponse?.run_id || assistantSelectedCardIds.length === 0) {
      setMessage("请选择要加入图谱的助手候选卡片");
      return;
    }
    setBusy(true);
    setMessage("正在将助手候选卡片加入图谱...");
    try {
      const updated = await approveRunCards(assistantResponse.run_id, assistantSelectedCardIds);
      await refreshActiveKnowledgeBase(updated.knowledge_base_id);
      const detail = await fetchRunDetail(updated.id);
      setSelectedRun(detail.run);
      setCards(detail.cards);
      setRunSources(detail.sources);
      setAssistantResponse((current) => current
        ? {
            ...current,
            candidate_cards: current.candidate_cards.map((card) => (
              card.id !== null && assistantSelectedCardIds.includes(card.id)
                ? { ...card, approval_status: "approved" }
                : card
            )),
          }
        : current);
      setAssistantSelectedCardIds([]);
      setMessage(`已将 ${assistantSelectedCardIds.length} 张助手候选卡片加入图谱`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "助手候选卡片加入图谱失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleSelectRun(runId: number) {
    setMessage("正在加载任务详情...");
    try {
      const detail = await fetchRunDetail(runId);
      setSelectedRun(detail.run);
      setCards(detail.cards);
      setSelectedCardIds([]);
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
              knowledgeBasePrompt={knowledgeBasePrompt}
              keyword={keyword}
              mode={mode}
              onKnowledgeBasePromptChange={setKnowledgeBasePrompt}
              onSaveKnowledgePrompt={handleSaveKnowledgePrompt}
              onKeywordChange={setKeyword}
              onAiCollect={handleAiCollectRun}
              onModeChange={setMode}
              onRun={handleCreateRun}
              onRunPromptChange={setRunPrompt}
              runPrompt={runPrompt}
              selectedBaseName={activeKnowledgeBase ? knowledgeBaseName(activeKnowledgeBase) : "未选择知识库"}
            />
            <section className="dashboard-grid learn-grid">
              <CardsPanel
                busy={busy}
                cards={cards}
                modelForm={modelForm}
                modelSettings={modelSettings}
                onApproveSelected={handleApproveSelectedCards}
                onSelectAllCandidates={handleSelectAllCandidateCards}
                onToggleCardSelection={handleToggleCardSelection}
                onModelFormChange={setModelForm}
                onSaveModel={handleSaveModel}
                onSummarize={handleSummarizeRun}
                onTestModel={handleTestModel}
                selectedCardIds={selectedCardIds}
                selectedRun={selectedRun}
              />
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
              assistantAllowWeb={assistantAllowWeb}
              assistantCreateCandidates={assistantCreateCandidates}
              assistantOpen={assistantOpen}
              assistantQuestion={assistantQuestion}
              assistantResponse={assistantResponse}
              assistantSelectedCardIds={assistantSelectedCardIds}
              busy={busy}
              graph={graph}
              isEditingNode={isEditingNode}
              knowledgeBaseName={activeKnowledgeBase ? knowledgeBaseName(activeKnowledgeBase) : "当前知识库"}
              nodeForm={nodeForm}
              onApproveAssistantCandidates={handleApproveAssistantCandidates}
              onAskAssistant={handleAskAssistant}
              onCancelNodeEdit={handleCancelNodeEdit}
              onDeleteNode={handleDeleteNode}
              onEditNode={handleEditNode}
              onNodeFormChange={handleNodeFormChange}
              onSaveNode={handleSaveNode}
              onSelectNode={handleSelectNode}
              onSetAssistantAllowWeb={setAssistantAllowWeb}
              onSetAssistantCreateCandidates={setAssistantCreateCandidates}
              onSetAssistantOpen={setAssistantOpen}
              onSetAssistantQuestion={setAssistantQuestion}
              onStartNewNode={handleStartNewNode}
              onToggleAssistantCandidate={handleToggleAssistantCandidate}
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
              onDelete={handleDeleteKnowledgeBase}
              onNameChange={setNewKnowledgeBaseName}
              onSelect={setActiveKnowledgeBaseId}
            />
            <SettingsPanel
              busy={busy}
              modelForm={modelForm}
              modelSettings={modelSettings}
              onModelFormChange={setModelForm}
              onSaveModel={handleSaveModel}
              onTestModel={handleTestModel}
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
  knowledgeBasePrompt: string;
  keyword: string;
  mode: (typeof modes)[number];
  runPrompt: string;
  selectedBaseName: string;
  onAiCollect: () => void;
  onKnowledgeBasePromptChange: (value: string) => void;
  onKeywordChange: (value: string) => void;
  onModeChange: (value: (typeof modes)[number]) => void;
  onRun: () => void;
  onRunPromptChange: (value: string) => void;
  onSaveKnowledgePrompt: () => void;
};

function RunPanel({
  busy,
  knowledgeBasePrompt,
  keyword,
  mode,
  runPrompt,
  selectedBaseName,
  onAiCollect,
  onKnowledgeBasePromptChange,
  onKeywordChange,
  onModeChange,
  onRun,
  onRunPromptChange,
  onSaveKnowledgePrompt,
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
        <button className="run-button ai-run-button" type="button" onClick={onAiCollect} disabled={busy}>
          <Sparkles size={17} />
          <span>AI 采集</span>
        </button>
      </div>
      <div className="preference-controls">
        <label>
          <span>知识库偏好</span>
          <textarea
            aria-label="知识库偏好"
            rows={2}
            value={knowledgeBasePrompt}
            onChange={(event) => onKnowledgeBasePromptChange(event.target.value)}
          />
        </label>
        <label>
          <span>本次偏好</span>
          <textarea
            aria-label="本次偏好"
            rows={2}
            value={runPrompt}
            onChange={(event) => onRunPromptChange(event.target.value)}
          />
        </label>
        <button
          aria-label="保存学习偏好"
          className="icon-action preference-save"
          disabled={busy}
          onClick={onSaveKnowledgePrompt}
          title="保存学习偏好"
          type="button"
        >
          <Save size={17} />
        </button>
      </div>
    </section>
  );
}

function CardsPanel({
  busy,
  cards,
  modelForm,
  modelSettings,
  onApproveSelected,
  onModelFormChange,
  onSelectAllCandidates,
  onSaveModel,
  onSummarize,
  onTestModel,
  onToggleCardSelection,
  selectedCardIds,
  selectedRun,
}: {
  busy: boolean;
  cards: LearningCard[];
  modelForm: ModelFormState;
  modelSettings: ModelSettings | null;
  onApproveSelected: () => void;
  onModelFormChange: (value: ModelFormState | ((current: ModelFormState) => ModelFormState)) => void;
  onSelectAllCandidates: () => void;
  onSaveModel: () => void;
  onSummarize: () => void;
  onTestModel: () => void;
  onToggleCardSelection: (cardId: number, selected: boolean) => void;
  selectedCardIds: number[];
  selectedRun: LearningRun | null;
}) {
  const keywordHintCards = cards.filter((card) => card.type === "keyword_hint");
  const analysisCards = cards.filter((card) => card.type !== "keyword_hint");
  const candidateCount = cards.filter((card) => card.approval_status === "candidate").length;

  return (
    <div className="panel cards-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">阅读分析</p>
          <h2>知识提炼</h2>
        </div>
        <div className="panel-actions">
          <button
            aria-label="全选待加入"
            className="icon-action"
            disabled={busy || candidateCount === 0}
            onClick={onSelectAllCandidates}
            title="全选待加入"
            type="button"
          >
            <CirclePlus size={18} />
          </button>
          <button
            aria-label="加入选中知识"
            className="icon-action"
            disabled={busy || selectedCardIds.length === 0}
            onClick={onApproveSelected}
            title="加入选中知识"
            type="button"
          >
            <GitBranch size={18} />
          </button>
          <button
            aria-label="总结本次素材"
            className="icon-action"
            disabled={busy || !selectedRun}
            onClick={onSummarize}
            title="总结本次素材"
            type="button"
          >
            <Sparkles size={18} />
          </button>
        </div>
      </div>
      <AnalysisModelConfig
        busy={busy}
        modelForm={modelForm}
        modelSettings={modelSettings}
        onModelFormChange={onModelFormChange}
        onSaveModel={onSaveModel}
        onTestModel={onTestModel}
      />
      <KeywordHints
        cards={keywordHintCards}
        onToggleCardSelection={onToggleCardSelection}
        selectedCardIds={selectedCardIds}
      />
      <div className="card-list">
        {(analysisCards.length > 0 ? analysisCards : learningCards).map((card) => (
          <article className="learning-card" key={card.title}>
            <div className="card-title-row">
              {"id" in card ? (
                <input
                  aria-label={`选择知识卡片 ${card.title}`}
                  checked={selectedCardIds.includes(card.id)}
                  disabled={card.approval_status !== "candidate"}
                  type="checkbox"
                  onChange={(event) => onToggleCardSelection(card.id, event.target.checked)}
                />
              ) : null}
              <span>{cardTypeLabel(card.type)}</span>
              {"approval_status" in card ? (
                <small className={`approval-badge ${card.approval_status}`}>
                  {card.approval_status === "approved" ? "已加入图谱" : "待加入图谱"}
                </small>
              ) : null}
            </div>
            <h3>{card.title}</h3>
            <p>{"summary" in card ? card.summary : card.body}</p>
            {"details" in card && card.details ? <small>{card.details}</small> : null}
          </article>
        ))}
      </div>
    </div>
  );
}

function KeywordHints({
  cards,
  onToggleCardSelection,
  selectedCardIds,
}: {
  cards: LearningCard[];
  onToggleCardSelection: (cardId: number, selected: boolean) => void;
  selectedCardIds: number[];
}) {
  return (
    <section className="keyword-hints" aria-label="关键词提炼">
      <div className="keyword-hints-heading">
        <strong>关键词提炼</strong>
        <span>{cards.length > 0 ? `${cards.length} 个提示` : "等待总结或运行后生成"}</span>
      </div>
      <div className="keyword-hint-list">
        {cards.length === 0 ? (
          <p>总结或运行后，会在这里显示牵连的关键词知识点。</p>
        ) : (
          cards.map((card) => (
            <article className="keyword-hint" key={card.id || card.title}>
              <div className="keyword-hint-title">
                <input
                  aria-label={`选择关键词 ${card.title}`}
                  checked={selectedCardIds.includes(card.id)}
                  disabled={card.approval_status !== "candidate"}
                  type="checkbox"
                  onChange={(event) => onToggleCardSelection(card.id, event.target.checked)}
                />
                <strong>{card.title}</strong>
                <small className={`approval-badge ${card.approval_status}`}>
                  {card.approval_status === "approved" ? "已加入" : "待加入"}
                </small>
              </div>
              <p>{card.summary}</p>
              {card.details ? <small>{card.details}</small> : null}
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function AnalysisModelConfig({
  busy,
  modelForm,
  modelSettings,
  onModelFormChange,
  onSaveModel,
  onTestModel,
}: {
  busy: boolean;
  modelForm: ModelFormState;
  modelSettings: ModelSettings | null;
  onModelFormChange: (value: ModelFormState | ((current: ModelFormState) => ModelFormState)) => void;
  onSaveModel: () => void;
  onTestModel: () => void;
}) {
  const modelStatus = modelSettings?.api_key_reference ? `已保存：${modelSettings.model}` : "未保存 API Key";

  return (
    <div className="analysis-model-config" aria-label="阅读分析模型配置">
      <div className="analysis-model-status">
        <KeyRound size={16} />
        <strong>阅读模型</strong>
        <span>{modelStatus}</span>
      </div>
      <div className="analysis-model-grid">
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
            autoComplete="off"
            placeholder={modelSettings?.api_key_mask ?? "未保存"}
            type="password"
            value={modelForm.api_key}
            onChange={(event) => onModelFormChange((current) => ({ ...current, api_key: event.target.value }))}
          />
        </label>
        <div className="analysis-model-actions">
          <button className="secondary-button" type="button" onClick={onTestModel} disabled={busy}>
            <Activity size={16} />
            <span>测试连接</span>
          </button>
          <button className="secondary-button" type="button" onClick={onSaveModel} disabled={busy}>
            <Save size={16} />
            <span>保存模型</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function GraphPanel({
  assistantAllowWeb,
  assistantCreateCandidates,
  assistantOpen,
  assistantQuestion,
  assistantResponse,
  assistantSelectedCardIds,
  busy,
  graph,
  isEditingNode,
  knowledgeBaseName,
  nodeForm,
  onApproveAssistantCandidates,
  onAskAssistant,
  onCancelNodeEdit,
  onDeleteNode,
  onEditNode,
  onNodeFormChange,
  onSaveNode,
  onSelectNode,
  onSetAssistantAllowWeb,
  onSetAssistantCreateCandidates,
  onSetAssistantOpen,
  onSetAssistantQuestion,
  onStartNewNode,
  onToggleAssistantCandidate,
  selectedNode,
}: {
  assistantAllowWeb: boolean;
  assistantCreateCandidates: boolean;
  assistantOpen: boolean;
  assistantQuestion: string;
  assistantResponse: AssistantResponse | null;
  assistantSelectedCardIds: number[];
  busy: boolean;
  graph: GraphData;
  isEditingNode: boolean;
  knowledgeBaseName: string;
  nodeForm: NodeFormState;
  onApproveAssistantCandidates: () => void;
  onAskAssistant: () => void;
  onCancelNodeEdit: () => void;
  onDeleteNode: () => void;
  onEditNode: () => void;
  onNodeFormChange: (patch: Partial<NodeFormState>) => void;
  onSaveNode: () => void;
  onSelectNode: (nodeId: number) => void;
  onSetAssistantAllowWeb: (value: boolean) => void;
  onSetAssistantCreateCandidates: (value: boolean) => void;
  onSetAssistantOpen: (value: boolean) => void;
  onSetAssistantQuestion: (value: string) => void;
  onStartNewNode: () => void;
  onToggleAssistantCandidate: (cardId: number, selected: boolean) => void;
  selectedNode: KnowledgeNode | null;
}) {
  const [viewMode, setViewMode] = useState<GraphViewMode>("explore");
  const [graphQuery, setGraphQuery] = useState("");
  const [graphType, setGraphType] = useState("all");
  const [graphDepth, setGraphDepth] = useState(1);
  const graphTypes = useMemo(() => graphNodeTypes(graph), [graph]);
  const preparedGraph = useMemo(() => prepareGraphData(graph, {
    depth: graphDepth,
    query: graphQuery,
    selectedNodeId: selectedNode?.id ?? null,
    type: graphType,
    viewMode,
  }), [graph, graphDepth, graphQuery, graphType, selectedNode?.id, viewMode]);
  const relatedEdges = selectedNode ? relatedEdgesForNode(graph, selectedNode.id) : [];

  return (
    <div className="panel graph-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">知识图谱</p>
          <h2>知识关系</h2>
        </div>
        <div className="panel-actions">
          <button className="secondary-button" type="button" onClick={onStartNewNode} disabled={busy}>
            <CirclePlus size={16} />
            <span>新建关键点</span>
          </button>
          <button className="secondary-button" type="button" onClick={() => onSetAssistantOpen(true)} disabled={busy}>
            <MessageSquareText size={16} />
            <span>AI 助手</span>
          </button>
          <GitBranch size={19} />
        </div>
      </div>
      <div className="graph-summary">
        <span>{graph.nodes.length} 个节点</span>
        <span>{graph.edges.length} 条关系</span>
        <span>当前显示 {preparedGraph.nodes.length} 个</span>
        <span>{knowledgeBaseName}</span>
      </div>
      <div className="graph-toolbar" aria-label="图谱筛选工具">
        <div className="segmented compact">
          <button className={viewMode === "explore" ? "active" : ""} type="button" onClick={() => setViewMode("explore")}>关系探索</button>
          <button className={viewMode === "types" ? "active" : ""} type="button" onClick={() => setViewMode("types")}>类型分组</button>
          <button className={viewMode === "path" ? "active" : ""} type="button" onClick={() => setViewMode("path")}>学习路径</button>
        </div>
        <label>
          <Search size={15} />
          <input
            aria-label="搜索图谱节点"
            value={graphQuery}
            onChange={(event) => setGraphQuery(event.target.value)}
            placeholder="搜索节点"
          />
        </label>
        <select aria-label="节点类型筛选" value={graphType} onChange={(event) => setGraphType(event.target.value)}>
          <option value="all">全部类型</option>
          {graphTypes.map((type) => (
            <option key={type} value={type}>{nodeTypeLabel(type)}</option>
          ))}
        </select>
        <label className="depth-control">
          <span>深度</span>
          <input
            aria-label="关系深度"
            max="3"
            min="1"
            type="range"
            value={graphDepth}
            onChange={(event) => setGraphDepth(Number(event.target.value))}
          />
          <strong>{graphDepth}</strong>
        </label>
      </div>
      <div className="graph-workbench">
        <div className={viewMode === "explore" ? "graph-canvas vault-shell" : "graph-canvas"} aria-label="知识图谱工作台">
          {preparedGraph.nodes.length === 0 ? (
            <div className="graph-empty">
              <strong>{knowledgeBaseName}</strong>
              <span>暂无关键点</span>
              <button className="secondary-button" type="button" onClick={onStartNewNode} disabled={busy}>
                <CirclePlus size={16} />
                <span>新建关键点</span>
              </button>
            </div>
          ) : (
            <>
              <G6GraphCanvas
                edges={preparedGraph.edges}
                nodes={preparedGraph.nodes}
                onSelectNode={onSelectNode}
                selectedNodeId={selectedNode?.id ?? null}
                viewMode={viewMode}
              />
              <div className={viewMode === "explore" ? "graph-node-list vault-index" : "graph-node-list"} aria-label="图谱节点列表">
                {preparedGraph.nodes.map((node) => (
                  <button
                    aria-label={node.name}
                    className={`graph-node-chip node-${nodeVisualType(node.type)} ${selectedNode?.id === node.id ? "selected" : ""}`}
                    key={node.id}
                    onClick={() => onSelectNode(node.id)}
                    type="button"
                  >
                    <span>{node.name}</span>
                    <small>{nodeTypeLabel(node.type)}</small>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="node-detail">
          {isEditingNode ? (
            <NodeEditor
              busy={busy}
              nodeForm={nodeForm}
              onCancel={onCancelNodeEdit}
              onChange={onNodeFormChange}
              onSave={onSaveNode}
              selectedNode={selectedNode}
            />
          ) : selectedNode ? (
            <>
              <div className="node-detail-header">
                <div>
                  <p className="eyebrow">{nodeTypeLabel(selectedNode.type)}</p>
                  <h3>{selectedNode.name}</h3>
                </div>
                <div className="panel-actions">
                  <button className="icon-action" type="button" onClick={onEditNode} disabled={busy} aria-label="编辑关键点">
                    <SlidersHorizontal size={16} />
                  </button>
                  <button className="icon-action danger" type="button" onClick={onDeleteNode} disabled={busy} aria-label="删除关键点">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              <p>{selectedNode.summary || "暂无摘要。"}</p>
              <dl className="node-meta-list">
                <div>
                  <dt>相关关系</dt>
                  <dd>{relatedEdges.length}</dd>
                </div>
                <div>
                  <dt>别名</dt>
                  <dd>{selectedNode.aliases.length === 0 ? "暂无" : selectedNode.aliases.join("、")}</dd>
                </div>
              </dl>
              <div className="tag-row">
                {selectedNode.tags.length === 0
                  ? <span>暂无标签</span>
                  : selectedNode.tags.map((tag) => <span key={tag}>{tagLabel(tag)}</span>)}
              </div>
            </>
          ) : (
            <div className="node-empty-detail">
              <p className="empty-state compact">选择一个关键点查看相关内容，或新建一个关键点。</p>
              <button className="secondary-button" type="button" onClick={onStartNewNode} disabled={busy}>
                <CirclePlus size={16} />
                <span>新建关键点</span>
              </button>
            </div>
          )}
        </div>
      </div>
      <AssistantDrawer
        allowWeb={assistantAllowWeb}
        busy={busy}
        createCandidates={assistantCreateCandidates}
        onApproveCandidates={onApproveAssistantCandidates}
        onAsk={onAskAssistant}
        onClose={() => onSetAssistantOpen(false)}
        onQuestionChange={onSetAssistantQuestion}
        onToggleAllowWeb={onSetAssistantAllowWeb}
        onToggleCandidate={onToggleAssistantCandidate}
        onToggleCreateCandidates={onSetAssistantCreateCandidates}
        open={assistantOpen}
        question={assistantQuestion}
        response={assistantResponse}
        selectedCardIds={assistantSelectedCardIds}
        selectedNode={selectedNode}
      />
    </div>
  );
}

function G6GraphCanvas({
  edges,
  nodes,
  onSelectNode,
  selectedNodeId,
  viewMode,
}: {
  edges: GraphData["edges"];
  nodes: PreparedGraphNode[];
  onSelectNode: (nodeId: number) => void;
  selectedNodeId: number | null;
  viewMode: GraphViewMode;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const data = useMemo(() => ({
    nodes: nodes.map((node) => ({
      id: String(node.id),
      data: {
        label: node.name,
        type: node.type,
        group: node.group,
        distance: node.distance,
        muted: node.muted,
        priority: node.priority,
        selected: node.id === selectedNodeId,
        weight: node.weight,
      },
    })),
    edges: edges.map((edge) => ({
      id: String(edge.id),
      source: String(edge.source_node_id),
      target: String(edge.target_node_id),
      data: { label: edge.type },
    })),
  }), [edges, nodes, selectedNodeId]);

  useEffect(() => {
    if (!containerRef.current) return;
    const exploreMode = viewMode === "explore";
    const layout =
      viewMode === "path"
        ? { type: "dagre", rankdir: "LR", nodeSize: 42, ranksep: 92 }
        : viewMode === "types"
          ? { type: "grid", preventOverlap: true }
          : {
              type: "d3-force",
              collide: { radius: 44, strength: 0.92 },
              link: { distance: 118, strength: 0.42 },
              manyBody: { strength: -260 },
              x: { strength: 0.035 },
              y: { strength: 0.035 },
            };
    const options = {
      container: containerRef.current,
      autoFit: "view" as const,
      data,
      layout,
      node: {
        type: "circle",
        style: {
          size: (datum: { data?: { selected?: boolean; weight?: number } }) => {
            if (datum.data?.selected) return exploreMode ? 58 : 48;
            return exploreMode ? Math.min(48, 24 + (datum.data?.weight ?? 0) * 4) : 36;
          },
          fill: (datum: { data?: { type?: string } }) => nodeColor(datum.data?.type || "concept"),
          fillOpacity: (datum: { data?: { muted?: boolean } }) => (datum.data?.muted ? 0.22 : 0.96),
          stroke: (datum: { data?: { selected?: boolean; distance?: number | null } }) => {
            if (datum.data?.selected) return exploreMode ? "#f7faf8" : "#121815";
            if (exploreMode && datum.data?.distance === 1) return "#dce9e3";
            return exploreMode ? "#26322e" : "#ffffff";
          },
          strokeOpacity: (datum: { data?: { muted?: boolean } }) => (datum.data?.muted ? 0.2 : 0.92),
          lineWidth: (datum: { data?: { selected?: boolean; distance?: number | null } }) => {
            if (datum.data?.selected) return 4;
            return exploreMode && datum.data?.distance === 1 ? 2.2 : 1.4;
          },
          labelText: (datum: { data?: { label?: string } }) => datum.data?.label || "",
          labelFill: exploreMode ? "#dbe9e2" : "#24312b",
          labelFillOpacity: (datum: { data?: { muted?: boolean } }) => (datum.data?.muted ? 0.28 : 0.96),
          labelFontSize: (datum: { data?: { selected?: boolean; weight?: number } }) =>
            datum.data?.selected ? 14 : Math.min(12.5, 10.5 + (datum.data?.weight ?? 0) * 0.28),
          labelFontWeight: exploreMode ? 700 : 800,
          labelPlacement: "bottom",
          labelMaxWidth: exploreMode ? 140 : 120,
        },
        palette: viewMode === "types" ? { type: "group", field: "group" } : undefined,
      },
      edge: {
        type: "line",
        style: {
          stroke: exploreMode ? "#71817a" : "#9fb0a7",
          strokeOpacity: exploreMode ? 0.34 : 0.72,
          lineWidth: exploreMode ? 0.85 : 1.2,
          endArrow: !exploreMode,
          labelText: "",
        },
      },
      behaviors: exploreMode ? ["drag-canvas", "zoom-canvas", "drag-element-force"] : ["drag-canvas", "zoom-canvas", "drag-element"],
    } as unknown as ConstructorParameters<typeof Graph>[0];
    if (!graphRef.current) {
      graphRef.current = new Graph(options);
      graphRef.current.on("node:click", (event) => {
        const nodeId = Number(readGraphTargetId((event as { target?: unknown }).target));
        if (Number.isFinite(nodeId)) onSelectNode(nodeId);
      });
    } else {
      graphRef.current.setOptions(options);
    }
    graphRef.current.render();
    return () => {
      graphRef.current?.destroy();
      graphRef.current = null;
    };
  }, [data, onSelectNode, viewMode]);

  return <div className={viewMode === "explore" ? "g6-canvas vault-graph" : "g6-canvas"} ref={containerRef} />;
}

function AssistantDrawer({
  allowWeb,
  busy,
  createCandidates,
  onApproveCandidates,
  onAsk,
  onClose,
  onQuestionChange,
  onToggleAllowWeb,
  onToggleCandidate,
  onToggleCreateCandidates,
  open,
  question,
  response,
  selectedCardIds,
  selectedNode,
}: {
  allowWeb: boolean;
  busy: boolean;
  createCandidates: boolean;
  onApproveCandidates: () => void;
  onAsk: () => void;
  onClose: () => void;
  onQuestionChange: (value: string) => void;
  onToggleAllowWeb: (value: boolean) => void;
  onToggleCandidate: (cardId: number, selected: boolean) => void;
  onToggleCreateCandidates: (value: boolean) => void;
  open: boolean;
  question: string;
  response: AssistantResponse | null;
  selectedCardIds: number[];
  selectedNode: KnowledgeNode | null;
}) {
  return (
    <aside className={open ? "assistant-drawer open" : "assistant-drawer"} aria-label="图谱 AI 助手">
      <div className="assistant-header">
        <div>
          <p className="eyebrow">图谱 AI 助手</p>
          <h3>{selectedNode ? selectedNode.name : "当前知识库"}</h3>
        </div>
        <button className="icon-action" type="button" onClick={onClose} aria-label="关闭 AI 助手">
          <X size={16} />
        </button>
      </div>
      <textarea
        aria-label="AI 助手问题"
        value={question}
        onChange={(event) => onQuestionChange(event.target.value)}
        placeholder="例如：围绕这个节点，我下一步应该学什么？"
      />
      <div className="assistant-switches">
        <label>
          <input checked={allowWeb} type="checkbox" onChange={(event) => onToggleAllowWeb(event.target.checked)} />
          <span>允许联网补充</span>
        </label>
        <label>
          <input checked={createCandidates} type="checkbox" onChange={(event) => onToggleCreateCandidates(event.target.checked)} />
          <span>生成候选卡片</span>
        </label>
      </div>
      <button className="primary-button" type="button" onClick={onAsk} disabled={busy}>
        <Sparkles size={16} />
        <span>提问</span>
      </button>
      {response ? (
        <div className="assistant-result">
          <section>
            <h4>回答</h4>
            <p>{response.answer}</p>
          </section>
          <ReferenceList title="图谱引用" references={response.graph_references} />
          <ReferenceList title="联网补充" references={response.web_references} />
          {response.warnings.length > 0 ? (
            <section>
              <h4>提示</h4>
              {response.warnings.map((warning) => <p key={warning}>{warning}</p>)}
            </section>
          ) : null}
          {response.candidate_cards.length > 0 ? (
            <section className="assistant-candidates">
              <h4>候选知识</h4>
              {response.candidate_cards.map((card) => (
                <label key={card.id ?? card.title}>
                  <input
                    checked={card.id !== null && selectedCardIds.includes(card.id)}
                    disabled={busy || card.id === null || card.approval_status === "approved"}
                    type="checkbox"
                    onChange={(event) => card.id !== null && onToggleCandidate(card.id, event.target.checked)}
                  />
                  <span>
                    <strong>{card.title}</strong>
                    <small>{card.approval_status === "approved" ? "已加入" : card.summary}</small>
                  </span>
                </label>
              ))}
              <button className="secondary-button" type="button" onClick={onApproveCandidates} disabled={busy || selectedCardIds.length === 0}>
                <GitBranch size={16} />
                <span>加入选中知识</span>
              </button>
            </section>
          ) : null}
        </div>
      ) : (
        <p className="empty-state compact">选择节点后提问，助手会优先读取当前图谱，必要时联网补充。</p>
      )}
    </aside>
  );
}

function ReferenceList({ references, title }: { references: AssistantResponse["graph_references"]; title: string }) {
  if (references.length === 0) return null;
  return (
    <section>
      <h4>{title}</h4>
      <div className="assistant-reference-list">
        {references.map((reference, index) => (
          <a
            href={reference.url ?? "#"}
            key={`${reference.title}-${index}`}
            onClick={(event) => { if (!reference.url) event.preventDefault(); }}
            target={reference.url ? "_blank" : undefined}
            rel={reference.url ? "noreferrer" : undefined}
          >
            <strong>{reference.title}</strong>
            {reference.summary ? <span>{reference.summary}</span> : null}
          </a>
        ))}
      </div>
    </section>
  );
}

function NodeEditor({
  busy,
  nodeForm,
  onCancel,
  onChange,
  onSave,
  selectedNode,
}: {
  busy: boolean;
  nodeForm: NodeFormState;
  onCancel: () => void;
  onChange: (patch: Partial<NodeFormState>) => void;
  onSave: () => void;
  selectedNode: KnowledgeNode | null;
}) {
  return (
    <div className="node-editor">
      <div>
        <p className="eyebrow">{selectedNode ? "编辑关键点" : "新建关键点"}</p>
        <h3>{selectedNode ? selectedNode.name : "关键点信息"}</h3>
      </div>
      <label>
        <span>名称</span>
        <input
          aria-label="关键点名称"
          value={nodeForm.name}
          onChange={(event) => onChange({ name: event.target.value })}
          placeholder="例如：向量检索"
        />
      </label>
      <label>
        <span>类型</span>
        <select
          aria-label="关键点类型"
          value={nodeForm.type}
          onChange={(event) => onChange({ type: event.target.value })}
        >
          {nodeTypeOptions.map((type) => (
            <option key={type} value={type}>{nodeTypeLabel(type)}</option>
          ))}
        </select>
      </label>
      <label>
        <span>摘要</span>
        <textarea
          aria-label="关键点摘要"
          value={nodeForm.summary}
          onChange={(event) => onChange({ summary: event.target.value })}
          placeholder="写下这个关键点的学习价值、使用场景或注意事项"
        />
      </label>
      <label>
        <span>别名</span>
        <input
          aria-label="关键点别名"
          value={nodeForm.aliasesText}
          onChange={(event) => onChange({ aliasesText: event.target.value })}
          placeholder="多个别名用逗号分隔"
        />
      </label>
      <label>
        <span>标签</span>
        <input
          aria-label="关键点标签"
          value={nodeForm.tagsText}
          onChange={(event) => onChange({ tagsText: event.target.value })}
          placeholder="多个标签用逗号分隔"
        />
      </label>
      <div className="node-editor-actions">
        <button className="secondary-button" type="button" onClick={onCancel} disabled={busy}>取消</button>
        <button className="secondary-button primary-action" type="button" onClick={onSave} disabled={busy}>
          <Save size={16} />
          <span>保存关键点</span>
        </button>
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
          <p className="eyebrow">引用来源</p>
          <h2>素材证据</h2>
        </div>
        <SlidersHorizontal size={19} />
      </div>
      <div className="extracted-list">
        {runSources.length === 0 ? (
          <p className="empty-state">运行后会显示被模型阅读和引用的素材来源。</p>
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
  onTestModel,
}: {
  busy: boolean;
  modelForm: ModelFormState;
  modelSettings: ModelSettings | null;
  onModelFormChange: (value: ModelFormState | ((current: ModelFormState) => ModelFormState)) => void;
  onSaveModel: () => void;
  onTestModel: () => void;
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
            type="password"
            placeholder={modelSettings?.api_key_mask ?? "未保存"}
            onChange={(event) => onModelFormChange((current) => ({ ...current, api_key: event.target.value }))}
          />
        </label>
        <div className="form-actions">
          <button className="secondary-button" type="button" onClick={onTestModel} disabled={busy}>
            <Activity size={16} />
            <span>测试连接</span>
          </button>
          <button className="secondary-button" type="button" onClick={onSaveModel} disabled={busy}>
            <Save size={16} />
            <span>保存模型</span>
          </button>
        </div>
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
  onDelete,
  onNameChange,
  onSelect,
}: {
  activeKnowledgeBaseId: number | null;
  busy: boolean;
  knowledgeBases: KnowledgeBase[];
  newKnowledgeBaseName: string;
  onCreate: () => void;
  onDelete: (base: KnowledgeBase) => void;
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
          <div
            className={item.id === activeKnowledgeBaseId ? "knowledge-row selected" : "knowledge-row"}
            key={item.id}
          >
            <button className="knowledge-select-row" onClick={() => onSelect(item.id)} type="button">
              <strong>{knowledgeBaseName(item)}</strong>
              <span>{item.description || "暂无描述"}</span>
            </button>
            <button
              aria-label={`删除知识库 ${knowledgeBaseName(item)}`}
              className="icon-action danger"
              disabled={busy}
              onClick={() => onDelete(item)}
              title="删除知识库"
              type="button"
            >
              <Trash2 size={15} />
            </button>
          </div>
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
                <span>素材数</span>
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

function nodeVisualType(type: string) {
  if (type === "keyword") return "keyword";
  if (type === "skill" || type === "tool" || type === "method") return "skill";
  if (type === "project") return "project";
  return "concept";
}

function nodeColor(type: string) {
  if (type === "keyword") return "#121815";
  if (type === "skill" || type === "tool" || type === "method") return "#436f93";
  if (type === "project") return "#b76d21";
  if (type === "source") return "#6c766f";
  return "#1a8f72";
}

function readGraphTargetId(target: unknown): string | number | null {
  if (!target || typeof target !== "object") return null;
  const directId = (target as { id?: string | number }).id;
  if (directId !== undefined) return directId;
  const configId = (target as { config?: { id?: string | number } }).config?.id;
  if (configId !== undefined) return configId;
  const get = (target as { get?: (key: string) => unknown }).get;
  if (typeof get === "function") {
    const value = get.call(target, "id");
    if (typeof value === "string" || typeof value === "number") return value;
  }
  return null;
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

function toModelInput(modelForm: ModelFormState): ModelSettingsInput {
  return {
    ...modelForm,
    api_key: modelForm.api_key || undefined,
  };
}

function nodeToForm(node: KnowledgeNode): NodeFormState {
  return {
    name: node.name,
    type: node.type,
    summary: node.summary ?? "",
    aliasesText: node.aliases.join("，"),
    tagsText: node.tags.join("，"),
  };
}

function nodeFormToPayload(nodeForm: NodeFormState): KnowledgeNodeUpdate {
  return {
    type: nodeForm.type,
    name: nodeForm.name.trim(),
    summary: nodeForm.summary.trim() || null,
    aliases: splitTextList(nodeForm.aliasesText),
    tags: splitTextList(nodeForm.tagsText),
  };
}

function nodeFormToInput(nodeForm: NodeFormState, knowledgeBaseId: number): KnowledgeNodeInput {
  return {
    knowledge_base_id: knowledgeBaseId,
    type: nodeForm.type,
    name: nodeForm.name.trim(),
    summary: nodeForm.summary.trim() || null,
    aliases: splitTextList(nodeForm.aliasesText),
    tags: splitTextList(nodeForm.tagsText),
  };
}

function splitTextList(value: string): string[] {
  const seen = new Set<string>();
  return value
    .split(/[，,]/)
    .map((item) => item.trim())
    .filter((item) => {
      const key = item.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function relatedEdgesForNode(graph: GraphData, nodeId: number) {
  return graph.edges.filter((edge) => edge.source_node_id === nodeId || edge.target_node_id === nodeId);
}

function analysisModeLabel(cards: LearningCard[], modelSettings: ModelSettings | null): string {
  if (cards.length === 0) return "未生成阅读分析";
  const hasFallbackMarker = cards.some((card) => `${card.summary} ${card.details ?? ""}`.toLowerCase().includes("fallback"));
  if (hasFallbackMarker || !modelSettings?.api_key_reference) return "备用简略提纲";
  return "模型阅读分析";
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
