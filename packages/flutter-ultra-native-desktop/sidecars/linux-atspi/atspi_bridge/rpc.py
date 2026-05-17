"""Line-delimited JSON-RPC 2.0 framing over stdio.

We deliberately use line-delimited JSON instead of Content-Length framing
(LSP-style) — the TS server pipes us via ``child_process.spawn`` with
``stdio: ['pipe', 'pipe', 'pipe']`` and reads line-by-line. One request per
line; one response per line.

Errors follow the JSON-RPC error object shape so the TS server can
discriminate transport vs application failures.
"""

from __future__ import annotations

import json
import sys
import traceback
from dataclasses import dataclass
from typing import Any, Callable, Optional


@dataclass(frozen=True)
class RpcError:
    code: int
    message: str
    data: Any = None

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.data is not None:
            out["data"] = self.data
        return out


# JSON-RPC standard error codes (https://www.jsonrpc.org/specification#error_object)
PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603

# Application-defined codes (-32000..-32099 reserved range)
ATSPI_INIT_FAILED = -32001
ATSPI_NOT_FOUND = -32002
ATSPI_OPERATION_FAILED = -32003
WAYLAND_LIMITATION = -32004
TIMEOUT = -32005


Handler = Callable[[dict[str, Any]], Any]


def write_response(
    request_id: Any,
    *,
    result: Any = None,
    error: Optional[RpcError] = None,
) -> None:
    """Write one JSON response line to stdout. Flushes immediately."""
    payload: dict[str, Any] = {"jsonrpc": "2.0", "id": request_id}
    if error is not None:
        payload["error"] = error.to_dict()
    else:
        payload["result"] = result
    sys.stdout.write(json.dumps(payload, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def write_log(level: str, message: str, **extra: Any) -> None:
    """Write a structured log line to stderr. TS server captures + forwards."""
    payload = {"level": level, "msg": message, **extra}
    sys.stderr.write(json.dumps(payload, separators=(",", ":")) + "\n")
    sys.stderr.flush()


def run_loop(handlers: dict[str, Handler]) -> int:
    """Consume stdin line-by-line. Returns exit code."""
    write_log("info", "atspi-bridge started", pid=__import__("os").getpid())
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError as exc:
            write_response(None, error=RpcError(PARSE_ERROR, f"invalid JSON: {exc}"))
            continue

        if not isinstance(request, dict) or request.get("jsonrpc") != "2.0":
            write_response(
                request.get("id") if isinstance(request, dict) else None,
                error=RpcError(INVALID_REQUEST, "must be jsonrpc 2.0 request object"),
            )
            continue

        request_id = request.get("id")
        method = request.get("method")
        params = request.get("params") or {}

        if not isinstance(method, str):
            write_response(request_id, error=RpcError(INVALID_REQUEST, "method must be string"))
            continue
        if not isinstance(params, dict):
            write_response(request_id, error=RpcError(INVALID_PARAMS, "params must be object"))
            continue

        handler = handlers.get(method)
        if handler is None:
            write_response(
                request_id,
                error=RpcError(METHOD_NOT_FOUND, f"unknown method: {method}"),
            )
            continue

        try:
            result = handler(params)
            write_response(request_id, result=result)
        except RpcException as exc:
            write_response(request_id, error=exc.error)
        except Exception as exc:  # noqa: BLE001 — surface every failure to the TS server
            write_log(
                "error",
                "handler crashed",
                method=method,
                exc_type=type(exc).__name__,
                traceback=traceback.format_exc(),
            )
            write_response(
                request_id,
                error=RpcError(
                    INTERNAL_ERROR,
                    f"{type(exc).__name__}: {exc}",
                    data={"traceback": traceback.format_exc()},
                ),
            )

    write_log("info", "stdin closed; exiting")
    return 0


class RpcException(Exception):
    """Raise to return a typed JSON-RPC error to the caller."""

    def __init__(self, error: RpcError) -> None:
        super().__init__(error.message)
        self.error = error
