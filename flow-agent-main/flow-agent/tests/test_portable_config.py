from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_readme_exists():
    """Verify README.md exists in the flow-agent package directory."""
    readme = PROJECT_ROOT / "README.md"
    assert readme.is_file(), f"README.md not found at {readme}"


def test_docs_do_not_embed_user_specific_absolute_paths():
    readme = PROJECT_ROOT / "README.md"
    if readme.is_file():
        docs = readme.read_text(encoding="utf-8")
        assert "/Users/" not in docs
        assert "C:\\Users\\" not in docs
