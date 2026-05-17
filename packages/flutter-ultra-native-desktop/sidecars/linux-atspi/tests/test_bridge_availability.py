"""Tests that the bridge degrades gracefully when the AT-SPI binding is
missing — runs on Windows + macOS CI, exercises the import-guard path."""

from __future__ import annotations

import pytest

from atspi_bridge import bridge


def test_bridge_status_never_raises():
    """status() must always return a dict — no init required."""
    b = bridge.AtspiBridge()
    result = b.status({})
    assert isinstance(result, dict)
    assert "atspiAvailable" in result
    assert "atspiInitialised" in result
    assert "session" in result
    assert isinstance(result["session"], dict)
    assert "sessionType" in result["session"]


def test_bridge_reports_unavailable_when_gi_missing():
    """When PyGObject isn't installed we still get a clean error message."""
    b = bridge.AtspiBridge()
    if b.is_available():
        pytest.skip("PyGObject IS installed — skip the missing-binding path")
    result = b.status({})
    assert result["atspiAvailable"] is False
    assert "importError" in result
    assert "Install instructions" in result["importError"]


def test_ensure_initialised_raises_typed_error_when_unavailable():
    b = bridge.AtspiBridge()
    if b.is_available():
        pytest.skip("PyGObject IS installed — skip the missing-binding path")
    import atspi_bridge.rpc as rpc

    with pytest.raises(rpc.RpcException) as excinfo:
        b.ensure_initialised()
    assert excinfo.value.error.code == rpc.ATSPI_INIT_FAILED


def test_build_handlers_returns_full_method_table():
    b = bridge.AtspiBridge()
    handlers = bridge.build_handlers(b)
    expected = {
        "status",
        "list_windows",
        "get_active_window",
        "get_node",
        "get_children",
        "get_text",
        "find_by_name",
        "find_by_role",
        "find_by_id",
        "click",
        "double_click",
        "type_text",
        "grab_focus",
        "wait_for",
    }
    assert set(handlers.keys()) == expected
    for handler in handlers.values():
        assert callable(handler)


def test_require_str_rejects_missing_keys():
    import atspi_bridge.rpc as rpc

    with pytest.raises(rpc.RpcException) as excinfo:
        bridge.AtspiBridge._require_str({}, "nodeId")
    assert excinfo.value.error.code == rpc.INVALID_PARAMS


def test_require_str_rejects_empty_string():
    import atspi_bridge.rpc as rpc

    with pytest.raises(rpc.RpcException):
        bridge.AtspiBridge._require_str({"nodeId": ""}, "nodeId")


def test_require_str_rejects_non_string():
    import atspi_bridge.rpc as rpc

    with pytest.raises(rpc.RpcException):
        bridge.AtspiBridge._require_str({"nodeId": 123}, "nodeId")
