"""hermes-flutter-ultra — Hermes native plugin for the flutter-ultra MCP estate.

Generated at build time by ``scripts/emit-hermes.mjs``. The static Python
files (this module + ``bridge.py``) are copied from ``hermes-plugin-src/``;
``tools.json`` and ``plugin.yaml`` are generated from the probed tool list.

Registration follows the Hermes runtime wire (``ctx.register_tool`` per tool,
handler is a closure over the tool name that forwards to the MCP subprocess).
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict

from .bridge import SubprocessPool

logger = logging.getLogger(__name__)

__version__ = "0.1.0"

_POOL: SubprocessPool | None = None
_MANIFEST: Dict[str, Any] = {}


def _load_manifest() -> Dict[str, Any]:
    here = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(here, "tools.json")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _make_handler(tool_name: str):
    """Return a handler(args, **kwargs) that forwards to the MCP subprocess."""

    def handler(args: Any, **kwargs: Any) -> Dict[str, Any]:
        if _POOL is None:
            return {"error": "hermes-flutter-ultra: pool not initialized"}
        arg_map = args if isinstance(args, dict) else {}
        try:
            result = _POOL.call(tool_name, arg_map)
            # MCP tools/call returns {content: [{type, text}]} — unwrap to text.
            if isinstance(result, dict) and "content" in result:
                texts = [c.get("text", "") for c in result["content"] if c.get("type") == "text"]
                joined = "\n".join(texts)
                if result.get("isError"):
                    return {"error": joined}
                # Try JSON-parse if it looks like JSON.
                try:
                    return json.loads(joined)
                except (json.JSONDecodeError, TypeError):
                    return {"result": joined}
            return {"result": result}
        except KeyError as e:
            return {"error": str(e)}
        except Exception as e:
            logger.exception("hermes-flutter-ultra: tool %s failed", tool_name)
            return {"error": f"{type(e).__name__}: {e}"}

    handler.__name__ = f"flutter_ultra_{tool_name}"
    return handler


# Emoji per toolset (visual grouping in Hermes tool lists).
_TOOLSET_EMOJI = {
    "gesture": "👆",
    "browser": "🌐",
    "build": "🔨",
    "devtools": "🔧",
    "native_desktop": "🖥️",
    "native_mobile": "📱",
    "patrol": "🛡️",
    "runtime": "⚡",
}


def register(ctx: Any) -> None:
    """Register all flutter-ultra tools with the Hermes runtime."""
    global _POOL, _MANIFEST
    _MANIFEST = _load_manifest()
    _POOL = SubprocessPool(_MANIFEST)

    registered = 0
    for pkg_name, info in _MANIFEST.get("packages", {}).items():
        toolset = info.get("toolset", pkg_name)
        emoji = _TOOLSET_EMOJI.get(toolset, "⚡")
        for tool in info.get("tools", []):
            try:
                ctx.register_tool(
                    name=tool["name"],
                    toolset=f"flutter_ultra_{toolset}",
                    schema=tool.get("inputSchema", {"type": "object", "properties": {}}),
                    handler=_make_handler(tool["name"]),
                    description=tool.get("description", ""),
                    emoji=emoji,
                )
                registered += 1
            except Exception as exc:
                logger.warning(
                    "hermes-flutter-ultra: failed to register %s: %s", tool["name"], exc
                )

    logger.info("hermes-flutter-ultra: registered %d tools", registered)
    if not _POOL.available:
        logger.warning(
            "hermes-flutter-ultra: repo root not found — set FLUTTER_ULTRA_REPO env var"
        )


def unregister() -> None:
    """Clean up subprocess pool on plugin unload."""
    global _POOL
    if _POOL is not None:
        _POOL.shutdown()
        _POOL = None


__all__ = ["register", "unregister"]
