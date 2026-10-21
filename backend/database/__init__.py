"""Compatibility facade for the legacy database.py module."""

import importlib.util
from pathlib import Path


_legacy_path = Path(__file__).resolve().parent.parent / "database.py"
_spec = importlib.util.spec_from_file_location("_aqify_database_legacy", _legacy_path)
if _spec is None or _spec.loader is None:
	raise ImportError(f"Unable to load database models from {_legacy_path}")
_legacy = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_legacy)

for _name in dir(_legacy):
	if not _name.startswith("_"):
		globals()[_name] = getattr(_legacy, _name)
