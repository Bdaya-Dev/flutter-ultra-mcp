"""Display-server detection tests. Pure environment parsing — no a11y bus."""

from __future__ import annotations

import pytest

from atspi_bridge import wayland


def test_wayland_via_xdg_session_type(monkeypatch):
    monkeypatch.setenv("XDG_SESSION_TYPE", "wayland")
    monkeypatch.delenv("WAYLAND_DISPLAY", raising=False)
    monkeypatch.delenv("DISPLAY", raising=False)
    info = wayland.detect()
    assert info.session_type == "wayland"
    assert info.is_wayland()


def test_x11_via_xdg_session_type(monkeypatch):
    monkeypatch.setenv("XDG_SESSION_TYPE", "x11")
    monkeypatch.setenv("DISPLAY", ":0")
    monkeypatch.delenv("WAYLAND_DISPLAY", raising=False)
    info = wayland.detect()
    assert info.session_type == "x11"
    assert not info.is_wayland()


def test_wayland_inferred_from_wayland_display(monkeypatch):
    monkeypatch.delenv("XDG_SESSION_TYPE", raising=False)
    monkeypatch.setenv("WAYLAND_DISPLAY", "wayland-0")
    monkeypatch.delenv("DISPLAY", raising=False)
    info = wayland.detect()
    assert info.session_type == "wayland"


def test_x11_inferred_from_display(monkeypatch):
    monkeypatch.delenv("XDG_SESSION_TYPE", raising=False)
    monkeypatch.delenv("WAYLAND_DISPLAY", raising=False)
    monkeypatch.setenv("DISPLAY", ":0")
    info = wayland.detect()
    assert info.session_type == "x11"


def test_unknown_when_no_display(monkeypatch):
    monkeypatch.delenv("XDG_SESSION_TYPE", raising=False)
    monkeypatch.delenv("WAYLAND_DISPLAY", raising=False)
    monkeypatch.delenv("DISPLAY", raising=False)
    info = wayland.detect()
    assert info.session_type == "unknown"


def test_warning_only_on_wayland(monkeypatch):
    monkeypatch.setenv("XDG_SESSION_TYPE", "wayland")
    monkeypatch.setenv("XDG_CURRENT_DESKTOP", "GNOME")
    info = wayland.detect()
    warning = wayland.warning_message(info)
    assert warning is not None
    assert "Wayland" in warning
    assert "GNOME" in warning


def test_no_warning_on_x11(monkeypatch):
    monkeypatch.setenv("XDG_SESSION_TYPE", "x11")
    monkeypatch.setenv("DISPLAY", ":0")
    info = wayland.detect()
    assert wayland.warning_message(info) is None


def test_session_info_to_dict():
    info = wayland.SessionInfo(
        session_type="wayland",
        display=":0",
        wayland_display="wayland-0",
        desktop="GNOME",
    )
    d = info.to_dict()
    assert d == {
        "sessionType": "wayland",
        "display": ":0",
        "waylandDisplay": "wayland-0",
        "desktop": "GNOME",
    }
