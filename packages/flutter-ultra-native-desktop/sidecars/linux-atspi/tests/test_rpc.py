"""Unit tests for the JSON-RPC framing layer.

These tests run on any host (Linux, macOS, Windows) because ``rpc.py``
intentionally has no AT-SPI imports. They cover error code paths and
the response envelope shape that the TS sidecar registry depends on.
"""

from __future__ import annotations

import io
import json
import sys
from contextlib import redirect_stdout, redirect_stderr

import pytest

from atspi_bridge import rpc


def test_rpc_error_to_dict_omits_none_data():
    err = rpc.RpcError(code=-32601, message="bad")
    assert err.to_dict() == {"code": -32601, "message": "bad"}


def test_rpc_error_to_dict_includes_data():
    err = rpc.RpcError(code=-32603, message="boom", data={"trace": "..."})
    assert err.to_dict() == {"code": -32603, "message": "boom", "data": {"trace": "..."}}


def test_write_response_emits_result_envelope(capsys):
    rpc.write_response(7, result={"ok": True})
    out = capsys.readouterr().out
    payload = json.loads(out)
    assert payload == {"jsonrpc": "2.0", "id": 7, "result": {"ok": True}}


def test_write_response_emits_error_envelope(capsys):
    rpc.write_response(7, error=rpc.RpcError(rpc.METHOD_NOT_FOUND, "x"))
    out = capsys.readouterr().out
    payload = json.loads(out)
    assert payload == {
        "jsonrpc": "2.0",
        "id": 7,
        "error": {"code": rpc.METHOD_NOT_FOUND, "message": "x"},
    }


def test_run_loop_rejects_invalid_jsonrpc(monkeypatch, capsys):
    monkeypatch.setattr("sys.stdin", io.StringIO('{"id":1,"method":"x"}\n'))
    rpc.run_loop({})
    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines() if line.strip()]
    assert lines == [
        {
            "jsonrpc": "2.0",
            "id": 1,
            "error": {"code": rpc.INVALID_REQUEST, "message": "must be jsonrpc 2.0 request object"},
        }
    ]


def test_run_loop_rejects_parse_error(monkeypatch, capsys):
    monkeypatch.setattr("sys.stdin", io.StringIO("not json\n"))
    rpc.run_loop({})
    err = json.loads(capsys.readouterr().out)
    assert err["error"]["code"] == rpc.PARSE_ERROR


def test_run_loop_routes_to_handler(monkeypatch, capsys):
    monkeypatch.setattr(
        "sys.stdin",
        io.StringIO('{"jsonrpc":"2.0","id":3,"method":"echo","params":{"x":1}}\n'),
    )
    rpc.run_loop({"echo": lambda params: {"echoed": params}})
    payload = json.loads(capsys.readouterr().out)
    assert payload == {"jsonrpc": "2.0", "id": 3, "result": {"echoed": {"x": 1}}}


def test_run_loop_returns_method_not_found(monkeypatch, capsys):
    monkeypatch.setattr(
        "sys.stdin",
        io.StringIO('{"jsonrpc":"2.0","id":4,"method":"missing"}\n'),
    )
    rpc.run_loop({"other": lambda _: None})
    payload = json.loads(capsys.readouterr().out)
    assert payload["error"]["code"] == rpc.METHOD_NOT_FOUND


def test_run_loop_catches_handler_exception(monkeypatch, capsys):
    def boom(_):
        raise RuntimeError("kaboom")

    monkeypatch.setattr(
        "sys.stdin",
        io.StringIO('{"jsonrpc":"2.0","id":5,"method":"explode"}\n'),
    )
    rpc.run_loop({"explode": boom})
    payload = json.loads(capsys.readouterr().out)
    assert payload["error"]["code"] == rpc.INTERNAL_ERROR
    assert "kaboom" in payload["error"]["message"]
    assert "traceback" in payload["error"].get("data", {})


def test_run_loop_propagates_rpc_exception(monkeypatch, capsys):
    def typed(_):
        raise rpc.RpcException(rpc.RpcError(rpc.ATSPI_NOT_FOUND, "node gone"))

    monkeypatch.setattr(
        "sys.stdin",
        io.StringIO('{"jsonrpc":"2.0","id":6,"method":"go"}\n'),
    )
    rpc.run_loop({"go": typed})
    payload = json.loads(capsys.readouterr().out)
    assert payload["error"] == {"code": rpc.ATSPI_NOT_FOUND, "message": "node gone"}
