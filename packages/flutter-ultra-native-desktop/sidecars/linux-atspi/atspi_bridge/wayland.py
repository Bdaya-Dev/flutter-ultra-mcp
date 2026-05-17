"""Wayland-vs-X11 session detection.

AT-SPI 2 works fully on X11 because the a11y bus is a system D-Bus session
component accessible to any client process. On Wayland the same bus is
available, but specific compositors / toolkits gate which applications
expose their accessibility trees:

* GTK 3 / GTK 4 apps: fully exposed on both X11 and Wayland.
* Qt apps with ``QT_ACCESSIBILITY=1``: fully exposed.
* Electron apps: exposed only when launched with
  ``--force-renderer-accessibility`` AND ``ACCESSIBILITY_ENABLED=1``.
* Flutter Linux desktop apps (the primary target): expose only the
  active window, not the full desktop tree. Tracked upstream in
  flutter/flutter#107016. Local fallback: drive via the in-app
  ``ultra_flutter`` binding instead.

This module surfaces a structured warning so the MCP server can return it
once at startup AND attach it to any tool that touches the desktop root
(``list_windows``, ``find_by_*`` without a window-scoped root).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Literal


SessionType = Literal["x11", "wayland", "unknown"]


@dataclass(frozen=True)
class SessionInfo:
    session_type: SessionType
    display: str | None
    wayland_display: str | None
    desktop: str | None

    def is_wayland(self) -> bool:
        return self.session_type == "wayland"

    def to_dict(self) -> dict[str, object]:
        return {
            "sessionType": self.session_type,
            "display": self.display,
            "waylandDisplay": self.wayland_display,
            "desktop": self.desktop,
        }


def detect() -> SessionInfo:
    """Inspect the environment to classify the current display server.

    Order of precedence (matches systemd's logind heuristic):
    1. ``XDG_SESSION_TYPE`` — set by logind/gdm/sddm; authoritative.
    2. ``WAYLAND_DISPLAY`` — Wayland sockets only set this.
    3. ``DISPLAY`` — fallback X11 indicator.
    """
    xdg = (os.environ.get("XDG_SESSION_TYPE") or "").lower()
    wayland_display = os.environ.get("WAYLAND_DISPLAY")
    display = os.environ.get("DISPLAY")
    desktop = os.environ.get("XDG_CURRENT_DESKTOP")

    session_type: SessionType
    if xdg == "wayland":
        session_type = "wayland"
    elif xdg in {"x11", "tty"}:
        session_type = "x11" if xdg == "x11" else "unknown"
    elif wayland_display:
        session_type = "wayland"
    elif display:
        session_type = "x11"
    else:
        session_type = "unknown"

    return SessionInfo(
        session_type=session_type,
        display=display,
        wayland_display=wayland_display,
        desktop=desktop,
    )


def warning_message(info: SessionInfo) -> str | None:
    """Human-readable warning string for Wayland sessions, or None on X11."""
    if not info.is_wayland():
        return None
    desktop_hint = ""
    if info.desktop:
        desktop_hint = f" (compositor: {info.desktop})"
    return (
        f"AT-SPI is running under a Wayland session{desktop_hint}. "
        "Coverage of the accessible-object tree is limited: GTK/Qt apps "
        "with accessibility enabled work fully; Electron apps need "
        "--force-renderer-accessibility; Flutter Linux desktop apps "
        "currently expose only the active window (flutter/flutter#107016). "
        "For Flutter app introspection prefer the ultra_flutter in-app "
        "binding (flutter-ultra-gesture / flutter-ultra-runtime) instead "
        "of this server."
    )
