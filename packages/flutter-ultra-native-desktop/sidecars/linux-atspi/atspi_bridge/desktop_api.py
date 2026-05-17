"""Linux AT-SPI desktop API — implements the 9-method DesktopBackend
contract on top of low-level ``bridge.AtspiBridge`` primitives.

Mirrors the macOS Swift sidecar's RPC surface so the TS-side
``LinuxDesktopBackend`` is a thin pass-through.

External tools (optional, gracefully degraded):
* ``grim`` — Wayland screenshotter (sway, river, hyprland, ...)
* ``scrot`` / ``import`` (ImageMagick) / ``gnome-screenshot`` — X11
* ``xdotool`` — X11 input synthesis for cursor-coord clicks + typing
  into windows without AT-SPI EditableText support
* ``ydotool`` — Wayland equivalent (needs uinput permission)

When an external tool is missing the corresponding RPC returns a
typed error so the TS side can surface a human-readable remediation.
"""

from __future__ import annotations

import base64
import os
import re
import shutil
import subprocess
import time
from dataclasses import dataclass
from typing import Any, Callable

from . import rpc, wayland
from .bridge import AtspiBridge


# JSON-RPC error codes — stay aligned with macOS Swift sidecar where the
# semantic matches; Linux-specific failure modes use the -32_010+ range.
LINUX_ERR_PERMISSION_NOT_GRANTED = -32_000  # AT-SPI bus unreachable / no a11y
LINUX_ERR_WINDOW_NOT_FOUND = -32_001
LINUX_ERR_ELEMENT_NOT_FOUND = -32_002
LINUX_ERR_AT_SPI_FAILURE = -32_003
LINUX_ERR_DIALOG_TIMEOUT = -32_004
LINUX_ERR_SCREENSHOT_TOOL_MISSING = -32_010
LINUX_ERR_INPUT_TOOL_MISSING = -32_011
LINUX_ERR_UNSUPPORTED_QUERY = -32_012
LINUX_ERR_WAYLAND_LIMITATION = -32_013


WAYLAND_AT_SPI_REMEDIATION = (
    "AT-SPI on Wayland exposes only the active window for most toolkits "
    "(GTK/Qt apps with a11y enabled work fully; Flutter Linux apps expose "
    "only the active window — flutter/flutter#107016). "
    "For Flutter app introspection prefer the in-app ultra_flutter binding "
    "via flutter-ultra-gesture / flutter-ultra-runtime. "
    "For dialog/window automation, ensure the target compositor exposes "
    "the org.a11y.atspi bus (sway/river/hyprland require manual setup; "
    "GNOME and KDE expose it by default)."
)


@dataclass(frozen=True)
class HelloResponse:
    version: str
    helper_present: bool
    permission_granted: bool
    wayland_limited: bool
    remediation: str | None
    binding_version: dict[str, str] | None
    session: dict[str, Any]


class DesktopApi:
    """9-method DesktopBackend surface over AT-SPI + grim/scrot + xdotool."""

    def __init__(self, bridge: AtspiBridge) -> None:
        self._bridge = bridge
        self._session = wayland.detect()
        # Per-session cache of windowId → (app_idx, win_idx) so consumers
        # can use the same id throughout a session. Cleared every
        # list_windows() call to keep semantics simple.
        self._window_index: dict[str, tuple[int, int]] = {}

    # ------------------------------------------------------------------ hello

    def hello(self, _params: dict[str, Any]) -> dict[str, Any]:
        """Handshake — mirrors macOS sidecar's `hello` response."""
        binding_version: dict[str, str] | None = None
        permission_granted = False
        remediation: str | None = None
        if self._bridge.is_available():
            try:
                self._bridge.ensure_initialised()
                permission_granted = True
                binding_version = self._bridge._gi_versions()
            except rpc.RpcException as exc:
                permission_granted = False
                remediation = (
                    f"AT-SPI bus unreachable: {exc.error.message}. "
                    "Ensure at-spi2-core is installed and the session has "
                    "DBUS_SESSION_BUS_ADDRESS exported. "
                    "Without this, only the desktop is empty — apps need "
                    "to expose accessibility to be visible."
                )
        else:
            remediation = self._bridge.availability_error()
        if self._session.is_wayland() and permission_granted:
            # Wayland limitation is informational, not a hard failure —
            # AT-SPI still works for many apps. Append warning.
            wayland_warn = wayland.warning_message(self._session)
            if wayland_warn:
                remediation = (remediation + "\n" if remediation else "") + wayland_warn

        out: dict[str, Any] = {
            "version": "0.0.1",
            "helperPresent": self._bridge.is_available(),
            "permissionGranted": permission_granted,
            "waylandLimited": self._session.is_wayland(),
            "remediation": remediation,
            "session": self._session.to_dict(),
        }
        if binding_version is not None:
            out["bindingVersion"] = binding_version
        return out

    # ------------------------------------------------------------------ shutdown

    def shutdown(self, _params: dict[str, Any]) -> dict[str, Any]:
        # The TS side sends shutdown as a notification (no id); we still
        # accept it as a request and respond {ok: true}. The main loop
        # exits on stdin close, which the TS client triggers next.
        return {"ok": True}

    # ------------------------------------------------------------------ listWindows

    def list_windows(self, params: dict[str, Any]) -> list[dict[str, Any]]:
        self._bridge.ensure_initialised()
        process_name_filter = params.get("processName")
        title_pattern = params.get("titlePattern")
        title_re: re.Pattern[str] | None = None
        if isinstance(title_pattern, str) and title_pattern:
            # Substring match (case-insensitive); the registry doc says
            # "substring match" so we don't promise full regex semantics.
            title_re = re.compile(re.escape(title_pattern), re.IGNORECASE)

        result = self._bridge.list_windows({})
        self._window_index.clear()
        out: list[dict[str, Any]] = []
        for app in result.get("apps", []):
            app_name = app.get("appName", "")
            if process_name_filter and process_name_filter.lower() not in app_name.lower():
                continue
            app_idx = app.get("appIndex", 0)
            for win in app.get("windows", []):
                title = win.get("name") or ""
                if title_re and not title_re.search(title):
                    continue
                node_id = win.get("nodeId", "")
                # nodeId format from bridge: "{app_idx}/{win_idx}"
                parts = node_id.split("/")
                if len(parts) >= 2 and all(p.isdigit() for p in parts[:2]):
                    win_idx = int(parts[1])
                    self._window_index[node_id] = (app_idx, win_idx)
                states = win.get("states") or []
                extents = win.get("extents") or {"x": 0, "y": 0, "width": 0, "height": 0}
                out.append(
                    {
                        "id": node_id,
                        "title": title,
                        "processName": app_name,
                        # AT-SPI doesn't expose host pid directly via Accessible;
                        # callers needing PID can map via processName.
                        "pid": 0,
                        "bounds": extents,
                        "isMain": "active" in states,
                        "isMinimized": "iconified" in states,
                    }
                )
        return out

    # ------------------------------------------------------------------ dumpWindowTree

    def dump_window_tree(self, params: dict[str, Any]) -> dict[str, Any]:
        self._bridge.ensure_initialised()
        window_id = self._require_str(params, "windowId")
        max_depth = int(params.get("maxDepth", 12))
        if max_depth < 0 or max_depth > 64:
            raise rpc.RpcException(
                rpc.RpcError(rpc.INVALID_PARAMS, "maxDepth must be in [0, 64]")
            )

        try:
            root_node = self._bridge.get_node({"nodeId": window_id})
        except rpc.RpcException as exc:
            if exc.error.code == rpc.ATSPI_NOT_FOUND:
                raise rpc.RpcException(
                    rpc.RpcError(LINUX_ERR_WINDOW_NOT_FOUND, f"window not found: {window_id}")
                ) from exc
            raise
        return self._materialise_tree(window_id, root_node, depth=0, max_depth=max_depth)

    def _materialise_tree(
        self,
        node_id: str,
        node_dict: dict[str, Any],
        *,
        depth: int,
        max_depth: int,
    ) -> dict[str, Any]:
        out: dict[str, Any] = {
            "id": node_id,
            "role": node_dict.get("role") or "unknown",
            "title": node_dict.get("name"),
            "label": node_dict.get("description"),
            "value": (node_dict.get("attributes") or {}).get("value"),
            "enabled": "enabled" in (node_dict.get("states") or []),
            "focused": "focused" in (node_dict.get("states") or []),
            "bounds": node_dict.get("extents")
            or {"x": 0, "y": 0, "width": 0, "height": 0},
            "children": [],
        }
        if depth >= max_depth:
            return out
        try:
            children_result = self._bridge.get_children({"nodeId": node_id})
        except rpc.RpcException:
            return out
        for child in children_result.get("children", []):
            child_id = child.get("nodeId")
            if not child_id:
                continue
            out["children"].append(
                self._materialise_tree(child_id, child, depth=depth + 1, max_depth=max_depth)
            )
        return out

    # ------------------------------------------------------------------ desktopQuery

    def desktop_query(self, params: dict[str, Any]) -> list[dict[str, Any]]:
        """XPath subset:
        //role               → all descendants with that role
        //role[@name="X"]    → role + accessible-name equality
        //*[@label~="X"]     → any role + description contains X
        """
        self._bridge.ensure_initialised()
        window_id = self._require_str(params, "windowId")
        query = self._require_str(params, "query")
        max_results = int(params.get("maxResults", 50))

        spec = _parse_query(query)
        try:
            tree = self.dump_window_tree({"windowId": window_id, "maxDepth": 64})
        except rpc.RpcException:
            raise
        matches: list[dict[str, Any]] = []
        self._walk_tree(tree, lambda n: _node_matches(n, spec) and matches.append(n))
        if max_results > 0:
            matches = matches[:max_results]
        return matches

    @staticmethod
    def _walk_tree(node: dict[str, Any], visit: Callable[[dict[str, Any]], None]) -> None:
        visit(node)
        for child in node.get("children", []) or []:
            DesktopApi._walk_tree(child, visit)

    # ------------------------------------------------------------------ desktopClick

    def desktop_click(self, params: dict[str, Any]) -> dict[str, Any]:
        self._bridge.ensure_initialised()
        window_id = self._require_str(params, "windowId")
        element_id = params.get("elementId")
        x = params.get("x")
        y = params.get("y")
        button = params.get("button", "left")
        click_count = int(params.get("clickCount", 1))

        if isinstance(element_id, str) and element_id:
            # Prefer AT-SPI Action interface.
            try:
                result = self._bridge.click({"nodeId": element_id})
                if click_count >= 2:
                    self._bridge.click({"nodeId": element_id})
                if click_count >= 3:
                    self._bridge.click({"nodeId": element_id})
                return {"clicked": True, "via": "atspi", "result": result}
            except rpc.RpcException as exc:
                if exc.error.code == rpc.ATSPI_NOT_FOUND:
                    raise rpc.RpcException(
                        rpc.RpcError(
                            LINUX_ERR_ELEMENT_NOT_FOUND,
                            f"element not found: {element_id}",
                        )
                    ) from exc
                # AT-SPI couldn't action it (no Action interface); fall through
                # to coord-based click if extents are known.
                element = self._bridge.get_node({"nodeId": element_id})
                extents = element.get("extents")
                if extents and (x is None or y is None):
                    x = int(extents["x"] + extents["width"] / 2)
                    y = int(extents["y"] + extents["height"] / 2)
                else:
                    raise

        if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
            raise rpc.RpcException(
                rpc.RpcError(
                    rpc.INVALID_PARAMS,
                    "desktop_click requires either elementId or both x and y",
                )
            )

        # Coord-based click via xdotool/ydotool. Pick by session type.
        return self._coord_click(int(x), int(y), button=button, click_count=click_count)

    def _coord_click(self, x: int, y: int, *, button: str, click_count: int) -> dict[str, Any]:
        button_map = {"left": "1", "right": "3", "middle": "2"}
        if button not in button_map:
            raise rpc.RpcException(
                rpc.RpcError(rpc.INVALID_PARAMS, f"unknown button: {button}")
            )
        if self._session.is_wayland():
            tool = shutil.which("ydotool")
            if not tool:
                raise rpc.RpcException(
                    rpc.RpcError(
                        LINUX_ERR_INPUT_TOOL_MISSING,
                        "ydotool not found on PATH — required for cursor-coord "
                        "clicks on Wayland. Install via your distro package "
                        "manager (Debian/Ubuntu: ydotool; Fedora: ydotool). "
                        "Note: ydotool needs uinput permission "
                        "(add yourself to the 'input' group or run via systemd unit).",
                    )
                )
            # ydotool uses linux button codes 0x110=BTN_LEFT etc; click=N times.
            ydo_button = {"left": "0xC0", "right": "0xC2", "middle": "0xC1"}[button]
            for _ in range(click_count):
                self._run_cmd([tool, "click", ydo_button])
            return {"clicked": True, "via": "ydotool"}

        tool = shutil.which("xdotool")
        if not tool:
            raise rpc.RpcException(
                rpc.RpcError(
                    LINUX_ERR_INPUT_TOOL_MISSING,
                    "xdotool not found on PATH — required for cursor-coord "
                    "clicks on X11. Install via your distro package manager "
                    "(Debian/Ubuntu: xdotool; Fedora: xdotool; Arch: xdotool).",
                )
            )
        self._run_cmd([tool, "mousemove", str(x), str(y)])
        for _ in range(click_count):
            self._run_cmd([tool, "click", button_map[button]])
        return {"clicked": True, "via": "xdotool"}

    # ------------------------------------------------------------------ desktopType

    def desktop_type(self, params: dict[str, Any]) -> dict[str, Any]:
        self._bridge.ensure_initialised()
        _window_id = self._require_str(params, "windowId")  # accepted but not needed
        text = params.get("text")
        if not isinstance(text, str):
            raise rpc.RpcException(rpc.RpcError(rpc.INVALID_PARAMS, "text required"))
        element_id = params.get("elementId")
        clear_first = bool(params.get("clearFirst", False))

        if isinstance(element_id, str) and element_id:
            # Try AT-SPI EditableText path first; it works for native editable
            # widgets and bypasses focus/IME complications.
            try:
                result = self._bridge.type_text(
                    {"nodeId": element_id, "text": text, "clear": clear_first}
                )
                return {"typed": True, "via": "atspi", "result": result}
            except rpc.RpcException as exc:
                if exc.error.code == rpc.ATSPI_NOT_FOUND:
                    raise rpc.RpcException(
                        rpc.RpcError(
                            LINUX_ERR_ELEMENT_NOT_FOUND,
                            f"element not found: {element_id}",
                        )
                    ) from exc
                # Element exists but has no EditableText; fall through to
                # focus + key synthesis.
                self._bridge.grab_focus({"nodeId": element_id})

        # Key synthesis via xdotool/ydotool — types into the currently
        # focused widget (caller is expected to have focused it).
        if self._session.is_wayland():
            tool = shutil.which("ydotool")
            if not tool:
                raise rpc.RpcException(
                    rpc.RpcError(
                        LINUX_ERR_INPUT_TOOL_MISSING,
                        "ydotool not found — required for key synthesis on Wayland.",
                    )
                )
            if clear_first:
                # Ctrl+A then Delete.
                self._run_cmd([tool, "key", "29:1", "30:1", "30:0", "29:0"])
                self._run_cmd([tool, "key", "111:1", "111:0"])
            self._run_cmd([tool, "type", "--", text])
            return {"typed": True, "via": "ydotool"}

        tool = shutil.which("xdotool")
        if not tool:
            raise rpc.RpcException(
                rpc.RpcError(
                    LINUX_ERR_INPUT_TOOL_MISSING,
                    "xdotool not found — required for key synthesis on X11.",
                )
            )
        if clear_first:
            self._run_cmd([tool, "key", "ctrl+a"])
            self._run_cmd([tool, "key", "Delete"])
        self._run_cmd([tool, "type", "--", text])
        return {"typed": True, "via": "xdotool"}

    # ------------------------------------------------------------------ desktopScreenshot

    def desktop_screenshot(self, params: dict[str, Any]) -> dict[str, Any]:
        self._bridge.ensure_initialised()
        window_id = self._require_str(params, "windowId")
        scope = params.get("scope", "window")

        # Resolve bounds.
        node = self._bridge.get_node({"nodeId": window_id})
        extents = node.get("extents")
        if not extents:
            raise rpc.RpcException(
                rpc.RpcError(
                    LINUX_ERR_WINDOW_NOT_FOUND,
                    f"window {window_id} has no on-screen extents — likely off-screen or destroyed.",
                )
            )

        if self._session.is_wayland():
            tool = shutil.which("grim")
            if not tool:
                raise rpc.RpcException(
                    rpc.RpcError(
                        LINUX_ERR_SCREENSHOT_TOOL_MISSING,
                        "grim not found on PATH — required for Wayland screenshots. "
                        "Install via your distro package manager (sway/wlroots ecosystems ship it).",
                    )
                )
            args = [tool]
            if scope == "window":
                args += ["-g", f"{extents['x']},{extents['y']} {extents['width']}x{extents['height']}"]
            args += ["-"]
            png_bytes = self._run_cmd_capture(args)
        else:
            # X11 → prefer scrot, fall back to import (ImageMagick) or gnome-screenshot.
            tool = shutil.which("scrot")
            if tool:
                args = [tool]
                if scope == "window":
                    args += [
                        "-a",
                        f"{extents['x']},{extents['y']},{extents['width']},{extents['height']}",
                    ]
                args += ["--silent", "-"]
                png_bytes = self._run_cmd_capture(args)
            elif shutil.which("import"):
                tool = shutil.which("import")
                if scope == "window":
                    args = [
                        tool,
                        "-window",
                        "root",
                        "-crop",
                        f"{extents['width']}x{extents['height']}+{extents['x']}+{extents['y']}",
                        "png:-",
                    ]
                else:
                    args = [tool, "-window", "root", "png:-"]
                png_bytes = self._run_cmd_capture(args)
            else:
                raise rpc.RpcException(
                    rpc.RpcError(
                        LINUX_ERR_SCREENSHOT_TOOL_MISSING,
                        "No X11 screenshot tool found — install scrot or ImageMagick (import).",
                    )
                )
        return {"pngBase64": base64.b64encode(png_bytes).decode("ascii")}

    # ------------------------------------------------------------------ selectFileInDialog

    def select_file_in_dialog(self, params: dict[str, Any]) -> dict[str, Any]:
        self._bridge.ensure_initialised()
        path = self._require_str(params, "path")
        confirm_button = params.get("confirmButton") or "Open"
        # Strategy: focus the dialog's path entry (role=text inside role=dialog),
        # clear, type the path, then click the confirm button by name.
        dialog_id = self._locate_frontmost_dialog(
            window_id_hint=params.get("windowId"),
            process_name_hint=params.get("processName"),
        )
        # Find a text entry under the dialog.
        entries = self._find_by_role_within(dialog_id, "text") + self._find_by_role_within(
            dialog_id, "entry"
        )
        if not entries:
            raise rpc.RpcException(
                rpc.RpcError(
                    LINUX_ERR_ELEMENT_NOT_FOUND,
                    f"no text entry found in dialog {dialog_id} — toolkit may not expose path entry via AT-SPI",
                )
            )
        entry_id = entries[0]["nodeId"]
        self.desktop_type(
            {"windowId": dialog_id, "elementId": entry_id, "text": path, "clearFirst": True}
        )
        # Click the confirm button.
        buttons = self._find_by_name_within(dialog_id, confirm_button)
        if not buttons:
            raise rpc.RpcException(
                rpc.RpcError(
                    LINUX_ERR_ELEMENT_NOT_FOUND,
                    f"button '{confirm_button}' not found in dialog {dialog_id}",
                )
            )
        self._bridge.click({"nodeId": buttons[0]["nodeId"]})
        return {"confirmed": True}

    # ------------------------------------------------------------------ confirmDialog

    _INTENT_BUTTON_MAP: dict[str, list[str]] = {
        "allow": ["Allow", "Yes", "OK"],
        "deny": ["Deny", "No", "Cancel"],
        "ok": ["OK", "Okay"],
        "cancel": ["Cancel"],
        "yes": ["Yes"],
        "no": ["No"],
        "open": ["Open"],
        "save": ["Save"],
    }

    def confirm_dialog(self, params: dict[str, Any]) -> dict[str, Any]:
        self._bridge.ensure_initialised()
        intent = self._require_str(params, "intent")
        candidates = self._INTENT_BUTTON_MAP.get(intent)
        if not candidates:
            raise rpc.RpcException(
                rpc.RpcError(rpc.INVALID_PARAMS, f"unknown intent: {intent}")
            )
        dialog_id = self._locate_frontmost_dialog(
            window_id_hint=params.get("windowId"),
            process_name_hint=params.get("processName"),
        )
        for label in candidates:
            matches = self._find_by_name_within(dialog_id, label)
            if matches:
                self._bridge.click({"nodeId": matches[0]["nodeId"]})
                return {"confirmed": True, "matchedButton": label}
        raise rpc.RpcException(
            rpc.RpcError(
                LINUX_ERR_ELEMENT_NOT_FOUND,
                f"no button matching intent '{intent}' in dialog {dialog_id}; tried {candidates}",
            )
        )

    # ------------------------------------------------------------------ waitForWindow

    def wait_for_window(self, params: dict[str, Any]) -> dict[str, Any]:
        timeout_ms = int(params.get("timeoutMs", 30_000))
        poll_ms = max(50, int(params.get("pollMs", 250)))
        title_pattern = params.get("titlePattern")
        process_name = params.get("processName")
        deadline = time.monotonic() + (timeout_ms / 1000.0)
        last_count = 0
        while time.monotonic() < deadline:
            filter_params: dict[str, Any] = {}
            if isinstance(title_pattern, str):
                filter_params["titlePattern"] = title_pattern
            if isinstance(process_name, str):
                filter_params["processName"] = process_name
            windows = self.list_windows(filter_params)
            last_count = len(windows)
            if last_count > 0:
                return windows[0]
            time.sleep(poll_ms / 1000.0)
        raise rpc.RpcException(
            rpc.RpcError(
                LINUX_ERR_DIALOG_TIMEOUT,
                f"wait_for_window did not match within {timeout_ms}ms (last poll: {last_count} windows)",
            )
        )

    # ------------------------------------------------------------------ helpers

    def _locate_frontmost_dialog(
        self,
        *,
        window_id_hint: str | None,
        process_name_hint: str | None,
    ) -> str:
        if isinstance(window_id_hint, str) and window_id_hint:
            return window_id_hint
        # Best-effort: walk list_windows and pick the first window with
        # role=dialog or, failing that, with state=modal.
        params: dict[str, Any] = {}
        if isinstance(process_name_hint, str):
            params["processName"] = process_name_hint
        windows = self.list_windows(params)
        # The bridge already filters by name role; descend windows to find dialog.
        for w in windows:
            # heuristics: role-name "dialog" or "alert" or "frame" containing
            # text role "OK". We rely on caller to pass windowId when possible.
            try:
                node = self._bridge.get_node({"nodeId": w["id"]})
                if (node.get("role") or "").lower() in {"dialog", "alert", "frame"}:
                    return w["id"]
            except rpc.RpcException:
                continue
        if windows:
            return windows[0]["id"]
        raise rpc.RpcException(
            rpc.RpcError(
                LINUX_ERR_WINDOW_NOT_FOUND,
                "no dialog found — pass windowId or processName to scope the search",
            )
        )

    def _find_by_name_within(self, root: str, name: str) -> list[dict[str, Any]]:
        result = self._bridge.find_by_name({"name": name, "rootNodeId": root, "exact": True})
        matches = result.get("matches") or []
        if matches:
            return matches
        # Fall back to substring.
        result = self._bridge.find_by_name({"name": name, "rootNodeId": root, "exact": False})
        return result.get("matches") or []

    def _find_by_role_within(self, root: str, role: str) -> list[dict[str, Any]]:
        result = self._bridge.find_by_role({"role": role, "rootNodeId": root})
        return result.get("matches") or []

    @staticmethod
    def _run_cmd(cmd: list[str]) -> None:
        # Best-effort fire-and-forget; surface exit-code failures as
        # AT-SPI operation errors so the TS side can show the user.
        try:
            subprocess.run(cmd, check=True, capture_output=True, timeout=10)
        except subprocess.CalledProcessError as exc:
            raise rpc.RpcException(
                rpc.RpcError(
                    LINUX_ERR_AT_SPI_FAILURE,
                    f"{cmd[0]} failed (exit {exc.returncode}): {exc.stderr.decode('utf-8', 'replace')[:200]}",
                )
            ) from exc
        except subprocess.TimeoutExpired as exc:
            raise rpc.RpcException(
                rpc.RpcError(LINUX_ERR_AT_SPI_FAILURE, f"{cmd[0]} timed out")
            ) from exc

    @staticmethod
    def _run_cmd_capture(cmd: list[str]) -> bytes:
        try:
            result = subprocess.run(cmd, check=True, capture_output=True, timeout=30)
            return result.stdout
        except subprocess.CalledProcessError as exc:
            raise rpc.RpcException(
                rpc.RpcError(
                    LINUX_ERR_AT_SPI_FAILURE,
                    f"{cmd[0]} failed (exit {exc.returncode}): {exc.stderr.decode('utf-8', 'replace')[:200]}",
                )
            ) from exc
        except subprocess.TimeoutExpired as exc:
            raise rpc.RpcException(
                rpc.RpcError(LINUX_ERR_AT_SPI_FAILURE, f"{cmd[0]} timed out")
            ) from exc

    @staticmethod
    def _require_str(params: dict[str, Any], key: str) -> str:
        value = params.get(key)
        if not isinstance(value, str) or not value:
            raise rpc.RpcException(
                rpc.RpcError(rpc.INVALID_PARAMS, f"required string param missing: {key!r}")
            )
        return value


# --- XPath subset parser ----------------------------------------------------


@dataclass(frozen=True)
class _QuerySpec:
    role: str | None
    name_eq: str | None
    label_contains: str | None


_QUERY_RE = re.compile(
    r"""
    ^\s*//                          # //
    (?P<role>\*|[a-zA-Z_][\w-]*)    # role or *
    (?:                              # optional predicate
      \[
        @ (?P<attr>name|label)
        (?P<op>=|~=)
        "(?P<value>[^"]*)"
      \]
    )?
    \s*$
    """,
    re.VERBOSE,
)


def _parse_query(query: str) -> _QuerySpec:
    match = _QUERY_RE.match(query)
    if not match:
        raise rpc.RpcException(
            rpc.RpcError(
                LINUX_ERR_UNSUPPORTED_QUERY,
                f"unsupported XPath query: {query!r}. "
                'Supported subset: //role, //role[@name="X"], //*[@label~="X"]',
            )
        )
    role = match.group("role")
    if role == "*":
        role = None
    attr = match.group("attr")
    op = match.group("op")
    value = match.group("value")
    name_eq: str | None = None
    label_contains: str | None = None
    if attr == "name" and op == "=":
        name_eq = value
    elif attr == "label" and op == "~=":
        label_contains = value
    elif attr is not None:
        raise rpc.RpcException(
            rpc.RpcError(
                LINUX_ERR_UNSUPPORTED_QUERY,
                f"unsupported predicate: @{attr}{op}\"{value}\"",
            )
        )
    return _QuerySpec(role=role, name_eq=name_eq, label_contains=label_contains)


def _node_matches(node: dict[str, Any], spec: _QuerySpec) -> bool:
    if spec.role is not None and (node.get("role") or "").lower() != spec.role.lower():
        return False
    if spec.name_eq is not None and (node.get("title") or "") != spec.name_eq:
        return False
    if spec.label_contains is not None:
        label = node.get("label") or ""
        if spec.label_contains not in label:
            return False
    return True


def build_handlers(api: DesktopApi) -> dict[str, Callable[[dict[str, Any]], Any]]:
    """Return the method-name → handler table for the JSON-RPC loop.

    Names match the macOS Swift sidecar (camelCase) so the TS-side
    DesktopBackend implementations stay homogeneous.
    """
    return {
        "hello": api.hello,
        "shutdown": api.shutdown,
        "listWindows": api.list_windows,
        "dumpWindowTree": api.dump_window_tree,
        "desktopQuery": api.desktop_query,
        "desktopClick": api.desktop_click,
        "desktopType": api.desktop_type,
        "desktopScreenshot": api.desktop_screenshot,
        "selectFileInDialog": api.select_file_in_dialog,
        "confirmDialog": api.confirm_dialog,
        "waitForWindow": api.wait_for_window,
    }
