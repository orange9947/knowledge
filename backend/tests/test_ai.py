from app.ai import Material, fallback_output


def test_fallback_output_generates_cards_nodes_and_edges():
    output = fallback_output("AI Agent", [])

    assert [card.type for card in output.cards] == ["foundation", "current_practice", "learning_path"]
    assert any(node.type == "keyword" and node.name == "AI Agent" for node in output.nodes)
    assert any(edge.type == "contains" for edge in output.edges)


def test_fallback_source_node_does_not_reuse_keyword_name():
    output = fallback_output(
        "Example",
        [Material(title="Example", url="https://example.com", site="example.com", text="Example text")],
    )

    keyword_nodes = [node for node in output.nodes if node.type == "keyword"]
    source_nodes = [node for node in output.nodes if node.type == "source"]
    assert keyword_nodes[0].name == "Example"
    assert source_nodes[0].name.startswith("Source: Example")
