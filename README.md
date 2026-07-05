# AI 学习知识图谱

这是一个本地优先的辅助学习工具。你输入关键词，程序会从默认或自定义来源抓取相关资料，读取文章正文，并用模型提炼核心知识点、使用方法、实践项目和学习路径。任务、素材来源、分析结果和图谱节点会保存到 SQLite。不同知识库之间相互隔离，适合按行业、项目或学习方向分开沉淀。

## 当前能力

- 后端：FastAPI + SQLite，本地保存学习任务、素材来源、阅读分析、知识库和图谱数据。
- 前端：React/Vite，包含学习、知识图谱、历史记录和设置四个工作区。
- 知识库：新建知识库后，任务和图谱只归属当前知识库，不会全部混在一起；知识库也可以删除，但至少保留一个。
- 来源：内置 GitHub、掘金、Dev.to、Stack Overflow、Hacker News、Google 新闻 RSS，也支持自定义 RSS、站点、入口链接和搜索页；搜索页只用于发现候选链接，模型分析的是后续抓取到的具体素材正文。
- 模型：支持 OpenAI、DeepSeek 或兼容 OpenAI Chat Completions 的网关，并可在保存前测试连接。
- 阅读分析：支持学习偏好提示词、关键词提炼、AI 总结本次素材，以及 AI 直接筛选候选网页并采集；新生成的知识卡片默认需要手动挑选后才加入图谱。
- 历史：可以保留或删除任务，也可以保留、删除单个来源，或清空来源正文只保留元数据。
- 导入导出：支持 JSON 导入导出，不会导出原始 API Key。
- 无 Key 兜底：没有配置模型 API Key 时，会使用本地 fallback 生成粗略阅读提纲；高质量分析需要配置模型。

## 环境准备

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -e "backend[dev]"
npm install --prefix frontend
```

## 启动

启动后端：

```bash
. .venv/bin/activate
cd backend
python -m uvicorn app.main:app --reload
```

启动前端：

```bash
cd frontend
npm run dev
```

前端地址是 `http://localhost:5173`，接口请求会代理到 `http://localhost:8000`。

## 独立运行封装

桌面端封装应由 Electron 启动本地 FastAPI 后端，安卓端封装应由 Capacitor 承载同一套前端，并在 App 内启动本地 Python/FastAPI 后端。独立运行不需要自建服务器，但抓取网页、模型连接测试、AI 阅读分析和图谱助手联网补充仍然需要网络，因为它们会访问学习来源和模型 API。

### Windows 桌面端打开方式

当前桌面端是 Electron 外壳加本机 Python 后端，不是需要服务器部署的网站。打开 Windows 版有两种方式：

1. 推荐方式：在 GitHub 仓库进入 `Actions`，打开 `Windows Desktop Package`，等待运行完成后下载 `windows-desktop-package`。解压后运行 `AI 学习知识图谱-Setup-0.1.0-x64.exe` 安装版，或运行 `AI 学习知识图谱-Portable-0.1.0-x64.exe` 便携版。
2. 本地 Windows 构建：在 Windows 上安装 Node.js 22、Python 3.12 和 Git，然后执行下面的命令生成安装包。

```powershell
git clone https://github.com/orange9947/knowledge.git
cd knowledge
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e "backend[dev]" pyinstaller
npm ci --prefix frontend
npm ci --prefix desktop
npm run build:desktop:win
```

生成结果在 `desktop\dist\`。安装版和便携版启动后都会自动启动本机后端，数据保存在 Windows 用户数据目录里，不需要你自己开服务器。

### 桌面端开发运行

```bash
npm install --prefix desktop
npm run build:frontend
npm run build:backend:desktop
npm --prefix desktop run dev
```

### 桌面端后端打包

```bash
cd backend
pyinstaller pyinstaller.spec
```

### 安卓端调试包

```bash
npm install --prefix frontend
cd frontend
npx cap sync android
cd android
./gradlew assembleDebug
```

### 数据位置

桌面端数据应位于系统用户数据目录。安卓端数据应位于 App 私有目录。模型 API Key 写入本地 secrets 文件，不会写入导出的知识库 JSON。

## 使用指南

1. 打开前端页面。
2. 在顶部选择一个知识库，或进入“设置”新建知识库。
3. 回到“学习”，输入关键词。
4. 选择运行模式。默认“轻量”适合快速试用，“标准”和“深度”会尝试抓取更多候选来源。
5. 可填写“知识库偏好”和“本次偏好”。例如：`我是初学者，优先解释基础概念和可跟做的小项目`。知识库偏好会保存到当前知识库，本次偏好只影响新建任务。
6. 点击“运行”，等待任务按来源配置抓取素材、提取正文并生成阅读分析；也可以点击“AI 采集”，让模型先筛选具体网页再抓取和总结。
7. 在“学习”查看核心知识点、使用方法、实践项目、学习路径、关键词提炼和引用来源。新卡片会标记为“待加入图谱”。
8. 勾选有价值的卡片，点击“加入选中知识”，系统才会把对应节点和关系写入当前知识库图谱。
9. 对已运行或已选择的任务，点击“总结本次素材”，模型会对本次正文与当前知识库已有内容做对比，过滤重复和低价值内容后追加待筛选总结卡片。
10. 在“知识图谱”查看当前知识库中已批准的节点和关系，点击节点可查看摘要与标签。
11. 在“历史记录”筛选任务、查看某次任务来源，并按需保留或删除任务/来源。

## 配置模型

进入“设置”里的“模型”区域：

- `接口地址`：OpenAI 默认可用 `https://api.openai.com/v1`；DeepSeek 可填 `https://api.deepseek.com`。
- `模型名称`：按服务商填写，例如 `gpt-4.1-mini` 或 `deepseek-chat`。
- `API 密钥`：保存后只显示脱敏值，原始密钥不出现在导出文件里。

点击“测试连接”会用当前表单配置调用模型接口；如果 API Key 输入框为空，则使用已保存的密钥。配置模型后，新任务会优先使用模型阅读抓取正文，生成知识点、关键词提示、使用方法、实践项目和学习路径；如果模型调用失败，会回退到本地生成粗略提纲。新生成的卡片不会自动污染图谱，必须在学习板块手动加入。“AI 采集”和“总结本次素材”必须使用已保存的模型配置。

## 管理知识库

进入“设置”里的“知识库”区域：

- 输入名称后点击“创建知识库”。
- 点击知识库行可切换当前知识库。
- 点击删除图标会删除该知识库下的任务、来源、卡片、节点和关系。
- 系统不允许删除最后一个知识库。

## 管理来源

进入“设置”里的“学习来源”区域：

- 点击“新增来源”添加 RSS、站点、入口链接或搜索页。
- 搜索页 URL 可以使用 `{keyword}` 占位符，例如 `https://example.com/search?q={keyword}`。
- 关闭“启用”后，该来源不会参与后续任务。
- 点击“重置默认来源”会恢复默认来源草稿，点击“保存来源设置”后才会写入后端。

抓取是尽力而为的。有些网站会阻止爬取或依赖 JavaScript 渲染，系统会把对应来源标为“部分成功”或“失败”，不会中断整个学习任务。

## 历史与保留

“历史记录”里可以：

- 按关键词或状态筛选任务。
- 点击任务查看该任务抓取到的来源。
- 点击保留图标固定重要任务或来源。
- 删除任务会删除该任务下的素材来源、阅读分析和相关图谱数据。
- 删除单个来源只移除该来源及其引用。
- 清空正文会移除抓取正文，但保留标题、URL、站点、摘要、状态等元数据。

## 导入导出

在“历史记录”右上角：

- 点击“导出”下载当前知识库的数据 JSON。
- 点击“导入”选择 JSON 文件恢复数据。

导出文件包含知识库、任务、来源、卡片、节点和关系，不包含原始 API Key。

## 测试

后端：

```bash
. .venv/bin/activate
cd backend
pytest
```

前端：

```bash
cd frontend
npm test -- --run
npm run build
```

封装验证：

```bash
./scripts/verify-packaging.sh
```

该脚本会运行后端测试、前端测试和前端构建；如果存在桌面端或安卓端项目，也会尝试执行对应平台检查。不存在的平台项目会打印明确跳过原因。发布 standalone 前还需要按脚本末尾清单确认：模型配置测试、知识库增删切换隔离、来源配置、自定义来源、学习运行、AI 分析、卡片审批入图谱、历史保留删除、图谱助手和导入导出。

## 已知限制

- 当前任务执行是同步的，深度模式可能让请求等待较久。
- 搜索页解析依赖目标站点结构；如果无法发现具体文章或仓库链接，该来源会被跳过，不会把搜索结果页直接当作学习素材。
- 知识图谱目前是轻量预览和节点详情，不是完整图谱编辑器；候选知识需要先在学习板块批准后才会显示在图谱里。
- 本地 fallback 只生成粗略阅读提纲；想要跨文章比较和高质量知识提炼，需要配置模型 API Key。

## 相关文档

- 设计文档：`docs/superpowers/specs/2026-07-04-ai-learning-knowledge-graph-design.md`
- 实现计划：`docs/superpowers/plans/2026-07-04-ai-learning-knowledge-graph-implementation-plan.md`
