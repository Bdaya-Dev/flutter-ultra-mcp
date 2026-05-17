"""AT-SPI 2 operations against ``gi.repository.Atspi``.

The bridge holds at most one ``Atspi`` initialisation per process. It is
*not* thread-safe — AT-SPI's main loop is owned by the GLib default
context, and we serialise all requests through the single stdio JSON-RPC
loop in ``__main__``.

Identifiers
-----------
We expose accessibles to the TS server via stable string IDs of the form
``"{app_idx}/{path[0]}/{path[1]}/.../{path[n]}"`` where each path
component is the child index at that depth. This identifier round-trips
across multiple requests *within the same desktop snapshot* but is NOT
durable across application restarts or focus changes. Tools that need
durability should re-resolve via ``find_by_*`` each call.

Roles and states
----------------
AT-SPI roles are kebab-cased C constants (``ROLE_PUSH_BUTTON``); we return
the lowercased machine name (``push_button``) so callers can compare
with string equality regardless of locale.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

from . import rpc, wayland


# --- gi-based imports are guarded; bridge can be imported on Windows/macOS
# for unit testing of the JSON-RPC layer without the AT-SPI binding.
try:  # pragma: no cover — covered by Linux CI
    import gi

    gi.require_version("Atspi", "2.0")
    from gi.repository import Atspi, GLib  # type: ignore[import-not-found]

    _ATSPI_AVAILABLE = True
    _ATSPI_IMPORT_ERROR: BaseException | None = None
except (ImportError, ValueError) as _exc:  # pragma: no cover
    _ATSPI_AVAILABLE = False
    _ATSPI_IMPORT_ERROR = _exc
    Atspi = None  # type: ignore[assignment]
    GLib = None  # type: ignore[assignment]


# Static AT-SPI 2 role-name table — sourced from
# https://gnome.pages.gitlab.gnome.org/at-spi2-core/libatspi/enum.Role.html
# Only the table is hardcoded; resolution still goes through
# Atspi.role_get_name() at runtime when available. Hardcoded so error
# messages remain stable when the binding is missing (CI dry-run).
_ROLE_FALLBACK = {
    0: "invalid",
    1: "accelerator_label",
    2: "alert",
    20: "dialog",
    24: "entry",
    27: "filler",
    34: "frame",
    36: "icon",
    37: "image",
    38: "internal_frame",
    41: "label",
    44: "list",
    45: "list_item",
    46: "menu",
    47: "menu_bar",
    48: "menu_item",
    50: "page_tab",
    51: "page_tab_list",
    53: "panel",
    56: "popup_menu",
    58: "push_button",
    60: "radio_menu_item",
    61: "root_pane",
    63: "scroll_bar",
    64: "scroll_pane",
    66: "separator",
    67: "slider",
    68: "spin_button",
    71: "status_bar",
    72: "table",
    79: "text",
    80: "toggle_button",
    81: "tool_bar",
    82: "tool_tip",
    83: "tree",
    84: "tree_table",
    86: "viewport",
    87: "window",
    91: "check_menu_item",
    93: "header",
    96: "paragraph",
    97: "ruler",
    98: "application",
    99: "autocomplete",
    100: "editbar",
    101: "embedded",
    102: "entry_password",
    104: "section",
    122: "block_quote",
    123: "audio",
    124: "video",
    125: "definition",
    126: "article",
    127: "landmark",
    128: "log",
    129: "marquee",
    130: "math",
    131: "rating",
    132: "timer",
    133: "static",
    134: "math_fraction",
    135: "math_root",
    137: "superscript",
    138: "subscript",
    139: "description_list",
    140: "description_term",
    141: "description_value",
    142: "footnote",
    143: "content_deletion",
    144: "content_insertion",
    145: "mark",
    146: "suggestion",
    147: "push_button_menu",
}


@dataclass(frozen=True)
class _NodeRef:
    """Internal handle to an Accessible. Owns the underlying GObject."""

    handle: Any  # an Atspi.Accessible (opaque to callers)
    node_id: str


class AtspiBridge:
    """All AT-SPI operations callable via JSON-RPC."""

    def __init__(self) -> None:
        self._initialised = False
        self._session = wayland.detect()

    # ------------------------------------------------------------------ init

    def is_available(self) -> bool:
        return _ATSPI_AVAILABLE

    def availability_error(self) -> str | None:
        if _ATSPI_AVAILABLE:
            return None
        return (
            "PyGObject AT-SPI binding not importable: "
            f"{type(_ATSPI_IMPORT_ERROR).__name__}: {_ATSPI_IMPORT_ERROR}. "
            "Install instructions vary by distro — see "
            "packages/flutter-ultra-native-desktop/sidecars/linux-atspi/README.md."
        )

    def ensure_initialised(self) -> None:
        if self._initialised:
            return
        if not _ATSPI_AVAILABLE:
            raise rpc.RpcException(
                rpc.RpcError(rpc.ATSPI_INIT_FAILED, self.availability_error() or "no atspi")
            )
        result = Atspi.init()
        # Atspi.init() returns 0 on success, 1 if already initialised, 2 on
        # failure (see at-spi2-core/atspi/atspi-misc.c). 0 or 1 are both ok.
        if result == 2:
            raise rpc.RpcException(
                rpc.RpcError(
                    rpc.ATSPI_INIT_FAILED,
                    "Atspi.init() returned 2 — a11y bus unreachable. "
                    "Ensure at-spi2-core is running and the user session has "
                    "DBUS_SESSION_BUS_ADDRESS set.",
                )
            )
        self._initialised = True

    # ------------------------------------------------------------------ status

    def status(self, _params: dict[str, Any]) -> dict[str, Any]:
        """Pre-flight check. Never raises; returns availability matrix."""
        info: dict[str, Any] = {
            "atspiAvailable": _ATSPI_AVAILABLE,
            "atspiInitialised": self._initialised,
            "session": self._session.to_dict(),
            "waylandWarning": wayland.warning_message(self._session),
        }
        if _ATSPI_AVAILABLE:
            info["bindingVersion"] = self._gi_versions()
        else:
            info["importError"] = self.availability_error()
        return info

    def _gi_versions(self) -> dict[str, str]:
        return {
            "atspi": f"{Atspi._version}" if hasattr(Atspi, "_version") else "unknown",
            "glib": GLib.glib_version_string() if hasattr(GLib, "glib_version_string") else "unknown",
        }

    # ------------------------------------------------------------------ tree

    def _desktop_root(self) -> Any:
        # Atspi.get_desktop(0) returns the single desktop frame; child_count
        # is the active application count.
        return Atspi.get_desktop(0)

    def _resolve(self, node_id: str) -> Any:
        """Walk the node id back to a live Atspi.Accessible."""
        parts = node_id.split("/")
        if not parts or not all(p.isdigit() for p in parts):
            raise rpc.RpcException(
                rpc.RpcError(rpc.INVALID_PARAMS, f"malformed nodeId: {node_id!r}")
            )
        node = self._desktop_root()
        try:
            for idx_str in parts:
                idx = int(idx_str)
                if idx < 0 or idx >= node.get_child_count():
                    raise rpc.RpcException(
                        rpc.RpcError(
                            rpc.ATSPI_NOT_FOUND,
                            f"node {node_id!r} no longer exists at index {idx}",
                        )
                    )
                node = node.get_child_at_index(idx)
                if node is None:
                    raise rpc.RpcException(
                        rpc.RpcError(rpc.ATSPI_NOT_FOUND, f"node {node_id!r} gone (None child)")
                    )
        except GLib.Error as exc:
            raise rpc.RpcException(
                rpc.RpcError(rpc.ATSPI_OPERATION_FAILED, f"GLib error walking {node_id!r}: {exc}")
            ) from exc
        return node

    def _node_to_dict(
        self,
        accessible: Any,
        *,
        node_id: str,
        include_extents: bool = False,
    ) -> dict[str, Any]:
        try:
            name = accessible.get_name()
        except GLib.Error:
            name = None
        try:
            role_num = int(accessible.get_role())
        except GLib.Error:
            role_num = 0
        try:
            role_name = accessible.get_role_name()
        except GLib.Error:
            role_name = _ROLE_FALLBACK.get(role_num, f"role_{role_num}")
        try:
            description = accessible.get_description()
        except GLib.Error:
            description = None
        try:
            child_count = accessible.get_child_count()
        except GLib.Error:
            child_count = 0
        try:
            attrs_iter = accessible.get_attributes()
            attributes = dict(attrs_iter) if attrs_iter else {}
        except GLib.Error:
            attributes = {}
        states: list[str] = []
        try:
            state_set = accessible.get_state_set()
            if state_set is not None:
                states = [
                    state.value_nick
                    for state in Atspi.StateType.__enum_values__.values()
                    if state_set.contains(state)
                ] if hasattr(Atspi.StateType, "__enum_values__") else self._enum_states(state_set)
        except GLib.Error:
            states = []

        out: dict[str, Any] = {
            "nodeId": node_id,
            "name": name,
            "role": role_name.replace(" ", "_").lower() if role_name else None,
            "description": description,
            "childCount": child_count,
            "attributes": attributes,
            "states": states,
        }
        if include_extents:
            out["extents"] = self._get_extents(accessible)
        return out

    @staticmethod
    def _enum_states(state_set: Any) -> list[str]:
        """Fallback state enumeration via known AT-SPI state names."""
        known = (
            "active", "armed", "busy", "checked", "collapsed", "defunct",
            "editable", "enabled", "expandable", "expanded", "focusable",
            "focused", "has_tooltip", "horizontal", "iconified", "modal",
            "multi_line", "multiselectable", "opaque", "pressed", "resizable",
            "selectable", "selected", "sensitive", "showing", "single_line",
            "stale", "transient", "vertical", "visible", "manages_descendants",
            "indeterminate", "required", "truncated", "animated", "invalid_entry",
            "supports_autocompletion", "selectable_text", "is_default", "visited",
            "checkable", "has_popup", "read_only",
        )
        out = []
        for name in known:
            try:
                value = getattr(Atspi.StateType, name.upper())
            except AttributeError:
                continue
            if state_set.contains(value):
                out.append(name)
        return out

    def _get_extents(self, accessible: Any) -> dict[str, int] | None:
        try:
            component = accessible.get_component_iface()
        except (GLib.Error, AttributeError):
            return None
        if component is None:
            return None
        try:
            rect = accessible.get_extents(Atspi.CoordType.SCREEN)
        except (GLib.Error, AttributeError):
            return None
        return {"x": rect.x, "y": rect.y, "width": rect.width, "height": rect.height}

    # ------------------------------------------------------------------ list windows

    def list_windows(self, _params: dict[str, Any]) -> dict[str, Any]:
        self.ensure_initialised()
        root = self._desktop_root()
        apps: list[dict[str, Any]] = []
        try:
            app_count = root.get_child_count()
        except GLib.Error as exc:
            raise rpc.RpcException(
                rpc.RpcError(rpc.ATSPI_OPERATION_FAILED, f"desktop child_count failed: {exc}")
            ) from exc

        for app_idx in range(app_count):
            try:
                app = root.get_child_at_index(app_idx)
            except GLib.Error:
                continue
            if app is None:
                continue
            try:
                app_name = app.get_name() or ""
            except GLib.Error:
                app_name = ""
            try:
                window_count = app.get_child_count()
            except GLib.Error:
                window_count = 0
            windows: list[dict[str, Any]] = []
            for win_idx in range(window_count):
                try:
                    win = app.get_child_at_index(win_idx)
                except GLib.Error:
                    continue
                if win is None:
                    continue
                node_id = f"{app_idx}/{win_idx}"
                windows.append(self._node_to_dict(win, node_id=node_id, include_extents=True))
            apps.append(
                {
                    "appIndex": app_idx,
                    "appName": app_name,
                    "windows": windows,
                }
            )
        return {"apps": apps, "waylandWarning": wayland.warning_message(self._session)}

    # ------------------------------------------------------------------ active window

    def get_active_window(self, _params: dict[str, Any]) -> dict[str, Any] | None:
        self.ensure_initialised()
        root = self._desktop_root()
        try:
            app_count = root.get_child_count()
        except GLib.Error:
            return None
        for app_idx in range(app_count):
            try:
                app = root.get_child_at_index(app_idx)
            except GLib.Error:
                continue
            if app is None:
                continue
            try:
                window_count = app.get_child_count()
            except GLib.Error:
                continue
            for win_idx in range(window_count):
                try:
                    win = app.get_child_at_index(win_idx)
                except GLib.Error:
                    continue
                if win is None:
                    continue
                state_set = win.get_state_set()
                if state_set is None:
                    continue
                if state_set.contains(Atspi.StateType.ACTIVE):
                    node_id = f"{app_idx}/{win_idx}"
                    return self._node_to_dict(win, node_id=node_id, include_extents=True)
        return None

    # ------------------------------------------------------------------ inspect

    def get_node(self, params: dict[str, Any]) -> dict[str, Any]:
        self.ensure_initialised()
        node_id = self._require_str(params, "nodeId")
        accessible = self._resolve(node_id)
        return self._node_to_dict(accessible, node_id=node_id, include_extents=True)

    def get_children(self, params: dict[str, Any]) -> dict[str, Any]:
        self.ensure_initialised()
        node_id = self._require_str(params, "nodeId")
        accessible = self._resolve(node_id)
        try:
            count = accessible.get_child_count()
        except GLib.Error as exc:
            raise rpc.RpcException(
                rpc.RpcError(rpc.ATSPI_OPERATION_FAILED, f"child_count failed: {exc}")
            ) from exc
        children = []
        for i in range(count):
            try:
                child = accessible.get_child_at_index(i)
            except GLib.Error:
                continue
            if child is None:
                continue
            child_id = f"{node_id}/{i}"
            children.append(self._node_to_dict(child, node_id=child_id))
        return {"children": children}

    def get_text(self, params: dict[str, Any]) -> dict[str, Any]:
        self.ensure_initialised()
        node_id = self._require_str(params, "nodeId")
        accessible = self._resolve(node_id)
        text = ""
        try:
            text_iface = accessible.get_text_iface()
            if text_iface is not None:
                count = accessible.get_character_count()
                text = accessible.get_text(0, count) if count > 0 else ""
        except (GLib.Error, AttributeError):
            pass
        # Fallback to .get_name() which many label/button roles use.
        if not text:
            try:
                text = accessible.get_name() or ""
            except GLib.Error:
                text = ""
        return {"text": text}

    # ------------------------------------------------------------------ find

    def find_by_name(self, params: dict[str, Any]) -> dict[str, Any]:
        self.ensure_initialised()
        target = self._require_str(params, "name")
        exact = bool(params.get("exact", True))
        scope = params.get("rootNodeId")
        root = self._resolve(scope) if isinstance(scope, str) else self._desktop_root()
        base_id = scope if isinstance(scope, str) else ""
        matches: list[dict[str, Any]] = []
        self._walk(root, base_id, lambda acc, nid: self._match_name(acc, target, exact, nid, matches))
        return {"matches": matches}

    def find_by_role(self, params: dict[str, Any]) -> dict[str, Any]:
        self.ensure_initialised()
        role = self._require_str(params, "role").lower().replace(" ", "_")
        scope = params.get("rootNodeId")
        root = self._resolve(scope) if isinstance(scope, str) else self._desktop_root()
        base_id = scope if isinstance(scope, str) else ""
        matches: list[dict[str, Any]] = []
        self._walk(root, base_id, lambda acc, nid: self._match_role(acc, role, nid, matches))
        return {"matches": matches}

    def find_by_id(self, params: dict[str, Any]) -> dict[str, Any]:
        """Match accessibles whose ``id`` attribute equals the query.

        AT-SPI exposes the developer-set id via ``Accessible.get_id()`` only
        when the application supplies it (GTK widgets often don't). Some
        toolkits stash a logical id in ``get_attributes()["id"]`` instead;
        we check both.
        """
        self.ensure_initialised()
        target = self._require_str(params, "id")
        scope = params.get("rootNodeId")
        root = self._resolve(scope) if isinstance(scope, str) else self._desktop_root()
        base_id = scope if isinstance(scope, str) else ""
        matches: list[dict[str, Any]] = []
        self._walk(root, base_id, lambda acc, nid: self._match_id(acc, target, nid, matches))
        return {"matches": matches}

    def _walk(self, root: Any, base_id: str, visit) -> None:
        try:
            count = root.get_child_count()
        except GLib.Error:
            return
        for i in range(count):
            try:
                child = root.get_child_at_index(i)
            except GLib.Error:
                continue
            if child is None:
                continue
            child_id = f"{base_id}/{i}" if base_id else str(i)
            visit(child, child_id)
            self._walk(child, child_id, visit)

    def _match_name(
        self,
        acc: Any,
        target: str,
        exact: bool,
        node_id: str,
        out: list[dict[str, Any]],
    ) -> None:
        try:
            name = acc.get_name() or ""
        except GLib.Error:
            return
        if exact:
            if name == target:
                out.append(self._node_to_dict(acc, node_id=node_id))
        else:
            if target.lower() in name.lower():
                out.append(self._node_to_dict(acc, node_id=node_id))

    def _match_role(
        self,
        acc: Any,
        target: str,
        node_id: str,
        out: list[dict[str, Any]],
    ) -> None:
        try:
            role_name = acc.get_role_name()
        except GLib.Error:
            return
        normalised = (role_name or "").replace(" ", "_").lower()
        if normalised == target:
            out.append(self._node_to_dict(acc, node_id=node_id))

    def _match_id(
        self,
        acc: Any,
        target: str,
        node_id: str,
        out: list[dict[str, Any]],
    ) -> None:
        candidate_ids: list[str] = []
        try:
            via_get_id = acc.get_id()
            if via_get_id is not None:
                candidate_ids.append(str(via_get_id))
        except (GLib.Error, AttributeError):
            pass
        try:
            attrs = acc.get_attributes()
            if attrs and "id" in attrs:
                candidate_ids.append(str(attrs["id"]))
        except GLib.Error:
            pass
        if target in candidate_ids:
            out.append(self._node_to_dict(acc, node_id=node_id))

    # ------------------------------------------------------------------ interact

    def click(self, params: dict[str, Any]) -> dict[str, Any]:
        return self._do_action(params, action_names=("click", "press", "activate"))

    def double_click(self, params: dict[str, Any]) -> dict[str, Any]:
        # AT-SPI doesn't have a guaranteed "doubleclick" action; trigger
        # click twice with a small gap. Real double-click semantics live
        # at the WM level which AT-SPI cannot reach without synthesising
        # X11/Wayland input — out of scope for the binding-driven path.
        first = self._do_action(params, action_names=("click", "press"))
        time.sleep(0.08)
        second = self._do_action(params, action_names=("click", "press"))
        return {"first": first, "second": second}

    def _do_action(
        self,
        params: dict[str, Any],
        *,
        action_names: tuple[str, ...],
    ) -> dict[str, Any]:
        self.ensure_initialised()
        node_id = self._require_str(params, "nodeId")
        accessible = self._resolve(node_id)
        try:
            action_iface = accessible.get_action_iface()
        except (GLib.Error, AttributeError) as exc:
            raise rpc.RpcException(
                rpc.RpcError(
                    rpc.ATSPI_OPERATION_FAILED,
                    f"node {node_id!r} does not implement the Action interface: {exc}",
                )
            ) from exc
        if action_iface is None:
            raise rpc.RpcException(
                rpc.RpcError(
                    rpc.ATSPI_OPERATION_FAILED,
                    f"node {node_id!r} has no Action interface — element is not actionable.",
                )
            )

        action_idx = self._find_action_index(accessible, action_names)
        if action_idx is None:
            raise rpc.RpcException(
                rpc.RpcError(
                    rpc.ATSPI_OPERATION_FAILED,
                    f"node {node_id!r} has no action matching {list(action_names)}.",
                )
            )

        try:
            success = accessible.do_action(action_idx)
        except GLib.Error as exc:
            raise rpc.RpcException(
                rpc.RpcError(rpc.ATSPI_OPERATION_FAILED, f"do_action({action_idx}) failed: {exc}")
            ) from exc
        return {"actionIndex": action_idx, "success": bool(success)}

    @staticmethod
    def _find_action_index(accessible: Any, names: tuple[str, ...]) -> int | None:
        try:
            n = accessible.get_n_actions()
        except (GLib.Error, AttributeError):
            return None
        for idx in range(n):
            try:
                action_name = (accessible.get_action_name(idx) or "").lower()
            except GLib.Error:
                continue
            if action_name in names:
                return idx
        return 0 if n > 0 else None

    def type_text(self, params: dict[str, Any]) -> dict[str, Any]:
        """Insert text via EditableText. Replaces existing selection."""
        self.ensure_initialised()
        node_id = self._require_str(params, "nodeId")
        text = self._require_str(params, "text")
        clear = bool(params.get("clear", False))
        accessible = self._resolve(node_id)
        try:
            editable = accessible.get_editable_text_iface()
        except (GLib.Error, AttributeError) as exc:
            raise rpc.RpcException(
                rpc.RpcError(
                    rpc.ATSPI_OPERATION_FAILED,
                    f"node {node_id!r} does not implement EditableText: {exc}",
                )
            ) from exc
        if editable is None:
            raise rpc.RpcException(
                rpc.RpcError(
                    rpc.ATSPI_OPERATION_FAILED,
                    f"node {node_id!r} has no EditableText interface — not a text field.",
                )
            )
        if clear:
            try:
                count = accessible.get_character_count()
                if count > 0:
                    accessible.delete_text(0, count)
            except GLib.Error as exc:
                raise rpc.RpcException(
                    rpc.RpcError(rpc.ATSPI_OPERATION_FAILED, f"clear failed: {exc}")
                ) from exc
        try:
            success = accessible.insert_text(accessible.get_caret_offset(), text, len(text.encode("utf-8")))
        except GLib.Error as exc:
            raise rpc.RpcException(
                rpc.RpcError(rpc.ATSPI_OPERATION_FAILED, f"insert_text failed: {exc}")
            ) from exc
        return {"success": bool(success), "wrote": text}

    def grab_focus(self, params: dict[str, Any]) -> dict[str, Any]:
        self.ensure_initialised()
        node_id = self._require_str(params, "nodeId")
        accessible = self._resolve(node_id)
        try:
            component = accessible.get_component_iface()
        except (GLib.Error, AttributeError):
            component = None
        if component is None:
            raise rpc.RpcException(
                rpc.RpcError(
                    rpc.ATSPI_OPERATION_FAILED,
                    f"node {node_id!r} has no Component interface — cannot grab focus.",
                )
            )
        try:
            success = accessible.grab_focus()
        except GLib.Error as exc:
            raise rpc.RpcException(
                rpc.RpcError(rpc.ATSPI_OPERATION_FAILED, f"grab_focus failed: {exc}")
            ) from exc
        return {"success": bool(success)}

    # ------------------------------------------------------------------ wait

    def wait_for(self, params: dict[str, Any]) -> dict[str, Any]:
        """Poll find_by_name/role until a match appears (or timeout)."""
        self.ensure_initialised()
        timeout_ms = int(params.get("timeoutMs", 5000))
        poll_ms = max(50, int(params.get("pollIntervalMs", 250)))
        criteria = params.get("criteria") or {}
        criteria_type = self._require_str(criteria, "type")
        deadline = time.monotonic() + (timeout_ms / 1000.0)
        last_count = 0
        while time.monotonic() < deadline:
            if criteria_type == "name":
                result = self.find_by_name(criteria)
            elif criteria_type == "role":
                result = self.find_by_role(criteria)
            elif criteria_type == "id":
                result = self.find_by_id(criteria)
            else:
                raise rpc.RpcException(
                    rpc.RpcError(rpc.INVALID_PARAMS, f"unknown criteria type: {criteria_type}")
                )
            matches = result.get("matches", [])
            last_count = len(matches)
            if last_count > 0:
                return {"matched": True, "matches": matches}
            time.sleep(poll_ms / 1000.0)
        raise rpc.RpcException(
            rpc.RpcError(
                rpc.TIMEOUT,
                f"wait_for did not match within {timeout_ms}ms (last poll: {last_count} matches).",
            )
        )

    # ------------------------------------------------------------------ helpers

    @staticmethod
    def _require_str(params: dict[str, Any], key: str) -> str:
        value = params.get(key)
        if not isinstance(value, str) or not value:
            raise rpc.RpcException(
                rpc.RpcError(rpc.INVALID_PARAMS, f"required string param missing: {key!r}")
            )
        return value


def build_handlers(bridge: AtspiBridge) -> dict[str, Any]:
    """Return the method-name → handler table for the JSON-RPC loop."""
    return {
        "status": bridge.status,
        "list_windows": bridge.list_windows,
        "get_active_window": bridge.get_active_window,
        "get_node": bridge.get_node,
        "get_children": bridge.get_children,
        "get_text": bridge.get_text,
        "find_by_name": bridge.find_by_name,
        "find_by_role": bridge.find_by_role,
        "find_by_id": bridge.find_by_id,
        "click": bridge.click,
        "double_click": bridge.double_click,
        "type_text": bridge.type_text,
        "grab_focus": bridge.grab_focus,
        "wait_for": bridge.wait_for,
    }
