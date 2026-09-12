"""MCP subprocess bridge for the hermes-flutter-ultra Hermes plugin.

Maintains a pool of stdio-spawned MCP server processes (one per flutter-ultra
package). Each tool handler forwards the call to the correct subprocess via
JSON-RPC over stdin/stdout. Subprocesses are started lazily on first use and
kept alive across calls.

Process lifecycle:
- Lazy start on first tool call for a package.
- ``initialize`` handshake sent once at startup.
- ``tools/call`` per invocation, parsed from newline-delimited JSON-RPC.
- ``shutdown()`` kills all children (called on plugin unload / interpreter exit).

Stderr from the child MCP server is discarded (it is structured JSON-logs that
Hermes' own logging does not need to see).
"""
from __future__ import annotations

import atexit
import json
import logging
import os
import subprocess
import sys
import threading
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

# Root of the flutter-ultra-mcp checkout. Resolved relative to THIS file, which
# lives at ``<hermes-plugins-dir>/hermes-flutter-ultra/bridge.py``. The MCP
# server bins are at ``<repo>/packages/<pkg>/dist/bin.js``.
#
# Hermes installs plugins at ``$HERMES_HOME/plugins/<name>/`` (or the bundled
# location). The emitted README tells the user to either install from a
# checkout or copy the directory; in both cases FLUTTER_ULTRA_REPO env var
# overrides auto-detection if the layout is non-standard.
def _resolve_repo_root() -> Optional[str]:
    env = os.environ.get("FLUTTER_ULTRA_REPO")
    if env:
        return env
    # Walk up from this file looking for the monorepo marker (turbo.json).
    here = os.path.dirname(os.path.abspath(__file__))
    cur = here
    for _ in range(8):
        if os.path.isfile(os.path.join(cur, "turbo.json")):
            return cur
        parent = os.path.dirname(cur)
        if parent == cur:
            break
        cur = parent
    return None


class McpSubprocess:
    """One MCP server subprocess, accessed via stdio JSON-RPC."""

    def __init__(self, bin_path: str, label: str):
        self.bin_path = bin_path
        self.label = label
        self.proc: Optional[subprocess.Popen] = None
        self._lock = threading.Lock()
        self._next_id = 1
        self._reader_thread: Optional[threading.Thread] = None
        self._pending: Dict[int, Any] = {}
        self._pending_cv = threading.Condition()
        self._stdout_buf = ""
        self._started = False

    def start(self) -> None:
        with self._lock:
            if self._started:
                return
            self.proc = subprocess.Popen(
                [sys.executable if self.bin_path.endswith(".py") else
                 os.environ.get("NODE_EXE", "node"),
                 self.bin_path],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                bufsize=0,
            )
            self._reader_thread = threading.Thread(
                target=self._read_loop, daemon=True, name=f"mcp-reader-{self.label}"
            )
            self._reader_thread.start()
            # MCP handshake.
            self._send_request("initialize", {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "hermes-flutter-ultra", "version": "0.1.0"},
            })
            # Initialized notification (no response expected).
            self._send_raw({
                "jsonrpc": "2.0",
                "method": "notifications/initialized",
            })
            self._started = True
            logger.info("hermes-flutter-ultra: started MCP server %s (pid %s)",
                        self.label, self.proc.pid)

    def _send_raw(self, msg: dict) -> None:
        assert self.proc and self.proc.stdin
        payload = json.dumps(msg) + "\n"
        self.proc.stdin.write(payload.encode("utf-8"))
        self.proc.stdin.flush()

    def _send_request(self, method: str, params: dict, timeout: float = 60.0) -> Any:
        assert self.proc
        # ORDER IS LOAD-BEARING: allocate the id AND register the pending entry
        # under ONE lock acquisition, and only THEN put the request on the wire.
        #
        # The previous order wrote to stdin first and registered afterwards,
        # leaving a window in which the subprocess could answer before the
        # reader thread had anything to match `msg_id` against. The reader
        # discards an unmatched response, so the waiter then blocked for the
        # FULL timeout -- 60s for `initialize`, 120s for `tools/call` -- on a
        # request that had in fact already been answered in milliseconds.
        #
        # The window is tight but genuinely reachable: `initialize` is the very
        # first request against a just-spawned process, and concurrent
        # `tools/call` invocations widen it under load. The symptom is the
        # confusing kind -- an inexplicable two-minute hang on a tool that
        # normally returns instantly.
        deadline = threading.Event()
        with self._pending_cv:
            req_id = self._next_id
            self._next_id += 1
            self._pending[req_id] = {"event": deadline, "result": None}
        self._send_raw({"jsonrpc": "2.0", "id": req_id, "method": method, "params": params})
        deadline.wait(timeout=timeout)
        with self._pending_cv:
            entry = self._pending.pop(req_id, None)
        if entry is None or entry["result"] is None:
            raise RuntimeError(f"MCP {self.label}: timeout waiting for {method} (id={req_id})")
        resp = entry["result"]
        if "error" in resp:
            raise RuntimeError(f"MCP {self.label}: {resp['error']}")
        return resp.get("result")

    def _read_loop(self) -> None:
        assert self.proc and self.proc.stdout
        try:
            for raw_line in self.proc.stdout:
                line = raw_line.decode("utf-8", errors="replace").rstrip("\n")
                if not line:
                    continue
                try:
                    msg = json.loads(line)
                except json.JSONDecodeError:
                    continue
                msg_id = msg.get("id")
                if msg_id is not None:
                    with self._pending_cv:
                        entry = self._pending.get(msg_id)
                        if entry is not None:
                            entry["result"] = msg
                            entry["event"].set()
        except Exception as e:
            logger.warning("hermes-flutter-ultra: reader for %s exited: %s", self.label, e)
        finally:
            # BOTH exit paths must land here, and the quiet one is the common
            # case: when the subprocess dies, stdout reaches EOF and the `for`
            # loop ends NORMALLY -- no exception is raised. Failing pending
            # requests only in `except` would therefore miss the ordinary crash
            # and leave every caller waiting out its full timeout.
            self._fail_all_pending("subprocess reader exited")

    def call_tool(self, tool_name: str, arguments: dict, timeout: float = 120.0) -> Any:
        self.start()
        result = self._send_request("tools/call", {
            "name": tool_name,
            "arguments": arguments,
        }, timeout=timeout)
        return result

    def _fail_all_pending(self, why: str) -> None:
        """Resolve every in-flight request with an error and clear the map.

        Without this, a subprocess that dies mid-call leaves each caller parked
        on ``deadline.wait(timeout=...)`` -- up to 120s for ``tools/call`` --
        because the reader thread that would have signalled them has already
        exited. The requests do eventually fail, but only by timing out one at
        a time, which reads as a hang rather than a crash. Failing them here
        turns a silent stall into an immediate, accurate error.
        """
        with self._pending_cv:
            pending = list(self._pending.items())
            self._pending.clear()
        for req_id, entry in pending:
            entry["result"] = {
                "error": {"code": -32000, "message": f"MCP {self.label}: {why}"}
            }
            entry["event"].set()
        if pending:
            logger.warning(
                "MCP %s: failed %d in-flight request(s): %s",
                self.label, len(pending), why,
            )

    def stop(self) -> None:
        with self._lock:
            if self.proc is not None:
                try:
                    self.proc.terminate()
                    self.proc.wait(timeout=5)
                except Exception:
                    try:
                        self.proc.kill()
                    except Exception:
                        pass
                self.proc = None
                self._started = False
        # Outside the lock: callers waiting on _pending_cv must not contend
        # with _lock, and a stopped subprocess can never answer them.
        self._fail_all_pending("subprocess stopped")


class SubprocessPool:
    """One McpSubprocess per package. Thread-safe, lazy-starting."""

    def __init__(self, manifest: dict):
        self._manifest = manifest
        self._repo_root = _resolve_repo_root()
        self._subs: Dict[str, McpSubprocess] = {}
        self._lock = threading.Lock()
        # Package name → tool name, for reverse lookup.
        self._tool_to_package: Dict[str, str] = {}
        for pkg_name, info in manifest.get("packages", {}).items():
            for tool in info.get("tools", []):
                self._tool_to_package[tool["name"]] = pkg_name
        atexit.register(self.shutdown)

    @property
    def available(self) -> bool:
        return self._repo_root is not None

    def _get_sub(self, pkg_name: str) -> McpSubprocess:
        with self._lock:
            sub = self._subs.get(pkg_name)
            if sub is None:
                info = self._manifest["packages"][pkg_name]
                if self._repo_root is None:
                    raise RuntimeError(
                        "hermes-flutter-ultra: could not locate flutter-ultra-mcp repo root. "
                        "Set FLUTTER_ULTRA_REPO env var to the checkout path."
                    )
                bin_path = os.path.join(self._repo_root, info["bin"])
                sub = McpSubprocess(bin_path, pkg_name)
                self._subs[pkg_name] = sub
            return sub

    def call(self, tool_name: str, arguments: dict) -> Any:
        pkg_name = self._tool_to_package.get(tool_name)
        if pkg_name is None:
            raise KeyError(f"Unknown flutter-ultra tool: {tool_name}")
        sub = self._get_sub(pkg_name)
        return sub.call_tool(tool_name, arguments or {})

    def shutdown(self) -> None:
        with self._lock:
            for sub in self._subs.values():
                try:
                    sub.stop()
                except Exception:
                    pass
            self._subs.clear()
