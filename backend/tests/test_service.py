from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import init_db
from app.discovery import SourceCandidate
from app.repositories import KnowledgeRepository
from app.schemas import LearningRunCreate, SourceConfigWrite, SourceCreate
from app.services import LearningRunService


class FakeCrawler:
    def crawl(self, run_id: int, candidate: SourceCandidate) -> SourceCreate:
        return SourceCreate(
            run_id=run_id,
            url=candidate.url,
            title=candidate.title,
            site=candidate.site,
            status="success",
            extracted_text="AI Agent source body " * 20,
            content_hash="hash",
            quality_score=0.8,
        )


class FakeAIOrchestrator:
    def __init__(self):
        self.last_generate_prompts = None
        self.last_summary_prompts = None
        self.last_target_prompts = None

    def generate(self, keyword, sources, model_config, knowledge_base_prompt=None, run_prompt=None):
        from app.ai import AIOutput, AICard, AIEdge, AINode

        self.last_generate_prompts = (knowledge_base_prompt, run_prompt)
        return AIOutput(
            cards=[
                AICard(type="key_point", title=f"{keyword} 核心知识点", summary="核心", source_indexes=[0]),
                AICard(type="keyword_hint", title=f"{keyword} 关键词提示", summary="提示", source_indexes=[0]),
            ],
            nodes=[
                AINode(type="keyword", name=keyword, tags=["keyword"]),
                AINode(type="concept", name=f"{keyword} 关键词提示", tags=["keyword_hint"]),
            ],
            edges=[AIEdge(source=keyword, target=f"{keyword} 关键词提示", type="related", source_indexes=[0])],
        )

    def summarize_run(
        self,
        keyword,
        sources,
        history_cards,
        history_nodes,
        model_config,
        knowledge_base_prompt=None,
        run_prompt=None,
    ):
        from app.ai import AIOutput, AICard, AIEdge, AINode

        self.last_summary_prompts = (knowledge_base_prompt, run_prompt)
        return AIOutput(
            cards=[
                AICard(type="summary", title=f"{keyword} 本次总结", summary="新增内容", source_indexes=[0]),
                AICard(type="keyword_hint", title="向量索引", summary="牵连关键词", source_indexes=[0]),
            ],
            nodes=[
                AINode(type="keyword", name=keyword, tags=["keyword"]),
                AINode(type="concept", name="向量索引", tags=["keyword_hint"]),
            ],
            edges=[AIEdge(source=keyword, target="向量索引", type="related", source_indexes=[0])],
        )

    def suggest_collection_targets(
        self,
        keyword,
        history_cards,
        history_nodes,
        model_config,
        knowledge_base_prompt=None,
        run_prompt=None,
    ):
        from app.ai import AITarget

        self.last_target_prompts = (knowledge_base_prompt, run_prompt)
        return [AITarget(url="https://docs.example.com/ai-agent-extra", title="AI Agent extra", reason="新增实践")]


def test_collect_sources_updates_run_and_persists_sources(tmp_path, monkeypatch):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'service.db'}",
        connect_args={"check_same_thread": False},
    )
    init_db(engine)
    Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = Session()
    try:
        repository = KnowledgeRepository(session)
        knowledge_base = repository.ensure_default_knowledge_base()
        repository.replace_source_configs(
            [
                SourceConfigWrite(
                    name="Docs",
                    type="entry_url",
                    enabled=True,
                    url_or_domain="https://docs.example.com/ai-agent",
                )
            ]
        )
        github_items = ", ".join(
            f"""
            {{
              "full_name": "example/ai-agent-{index}",
              "html_url": "https://github.com/example/ai-agent-{index}",
              "description": "AI Agent repository"
            }}
            """
            for index in range(12)
        )
        search_html = """
        <html><body>
          <a href="https://juejin.cn/post/7440000000000000000">AI Agent 掘金实践</a>
          <a href="https://www.zhihu.com/question/123456789/answer/987654321">AI Agent 知乎问答</a>
          <a href="https://sspai.com/post/88888">AI Agent 工作流</a>
          <a href="https://www.infoq.cn/article/ai-agent-production-guide">AI Agent 工程实践</a>
          <a href="https://blog.csdn.net/example/article/details/123456">AI Agent 部署记录</a>
          <a href="https://cloud.tencent.com/developer/article/2345678">AI Agent 云端实践</a>
          <a href="https://dev.to/example/ai-agent-guide">AI Agent guide</a>
          <a href="https://stackoverflow.com/questions/123456/ai-agent-pattern">AI Agent pattern</a>
          <a href="https://medium.com/@example/ai-agent-for-apps-123">AI Agent for apps</a>
          <a href="https://www.reddit.com/r/MachineLearning/comments/abc123/ai_agent_in_prod/">AI Agent in prod</a>
        </body></html>
        """
        feed = """
        <rss><channel>
          <item><title>AI Agent industry update</title><link>https://news.example.com/ai-agent</link></item>
        </channel></rss>
        """

        def fetch_text(url: str) -> str:
            if "api.github.com" in url:
                return f'{{"items": [{github_items}]}}'
            if "rss" in url:
                return feed
            return search_html

        monkeypatch.setattr("app.discovery.default_fetch_text", fetch_text)
        run = repository.create_run(LearningRunCreate(keyword="AI Agent", mode="light"))

        updated = LearningRunService(session, crawler=FakeCrawler()).collect_sources(run.id)

        assert updated is not None
        assert updated.status == "completed"
        sources = repository.list_sources_for_run(run.id)
        assert len(sources) == 10
        assert all(source.status == "success" for source in sources)
        assert "https://docs.example.com/ai-agent" in [source.url for source in sources]
        cards = repository.list_cards_for_run(run.id)
        assert [card.type for card in cards] == [
            "key_point",
            "usage_method",
            "practice_project",
            "learning_path",
            "recommended_reading",
            "keyword_hint",
        ]
        assert {card.approval_status for card in cards} == {"candidate"}
        nodes, edges = repository.list_graph(knowledge_base.id)
        assert nodes == []
        assert edges == []

        LearningRunService(session).approve_cards(run.id, [cards[0].id, cards[-1].id])
        approved_cards = repository.list_cards_for_run(run.id)
        assert [card.approval_status for card in approved_cards].count("approved") == 2
        nodes, edges = repository.list_graph(knowledge_base.id)
        assert len(nodes) >= 2
        assert len(edges) >= 1
    finally:
        session.close()


def test_summarize_run_persists_summary_and_keyword_hints(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'summary.db'}",
        connect_args={"check_same_thread": False},
    )
    init_db(engine)
    Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = Session()
    try:
        repository = KnowledgeRepository(session)
        repository.ensure_default_knowledge_base()
        run = repository.create_run(LearningRunCreate(keyword="AI Agent", mode="light"))
        repository.add_source(
            SourceCreate(
                run_id=run.id,
                url="https://docs.example.com/ai-agent",
                title="AI Agent docs",
                site="docs.example.com",
                status="success",
                extracted_text="AI Agent source body " * 20,
            )
        )

        updated = LearningRunService(session, ai_orchestrator=FakeAIOrchestrator()).summarize_run(run.id)

        assert updated is not None
        cards = repository.list_cards_for_run(run.id)
        assert {card.type for card in cards} == {"summary", "keyword_hint"}
        assert {card.approval_status for card in cards} == {"candidate"}
        assert any(card.title == "向量索引" for card in cards)
        nodes, _ = repository.list_graph(run.knowledge_base_id)
        assert not any(node.name == "向量索引" for node in nodes)

        LearningRunService(session).approve_cards(run.id, [card.id for card in cards])
        nodes, _ = repository.list_graph(run.knowledge_base_id)
        assert any(node.name == "向量索引" for node in nodes)
    finally:
        session.close()


def test_learning_preferences_are_passed_to_ai(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'preferences.db'}",
        connect_args={"check_same_thread": False},
    )
    init_db(engine)
    Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = Session()
    try:
        repository = KnowledgeRepository(session)
        knowledge_base = repository.ensure_default_knowledge_base()
        knowledge_base.learning_prompt = "我是初学者"
        session.commit()
        run = repository.create_run(
            LearningRunCreate(
                keyword="AI Agent",
                mode="light",
                learning_prompt="关注工具链和项目实践",
            )
        )
        repository.add_source(
            SourceCreate(
                run_id=run.id,
                url="https://docs.example.com/ai-agent",
                title="AI Agent docs",
                site="docs.example.com",
                status="success",
                extracted_text="AI Agent source body " * 20,
            )
        )
        ai = FakeAIOrchestrator()

        LearningRunService(session, ai_orchestrator=ai).summarize_run(run.id)

        assert ai.last_summary_prompts == ("我是初学者", "关注工具链和项目实践")
    finally:
        session.close()


def test_ai_collect_sources_crawls_ai_targets_and_summarizes(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'ai-collect.db'}",
        connect_args={"check_same_thread": False},
    )
    init_db(engine)
    Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = Session()
    try:
        repository = KnowledgeRepository(session)
        repository.ensure_default_knowledge_base()
        run = repository.create_run(LearningRunCreate(keyword="AI Agent", mode="light"))

        updated = LearningRunService(
            session,
            crawler=FakeCrawler(),
            ai_orchestrator=FakeAIOrchestrator(),
        ).ai_collect_sources(run.id)

        assert updated is not None
        assert updated.status == "completed"
        sources = repository.list_sources_for_run(run.id)
        assert [source.url for source in sources] == ["https://docs.example.com/ai-agent-extra"]
        cards = repository.list_cards_for_run(run.id)
        assert {card.type for card in cards} == {"summary", "keyword_hint"}
        assert {card.approval_status for card in cards} == {"candidate"}
    finally:
        session.close()
