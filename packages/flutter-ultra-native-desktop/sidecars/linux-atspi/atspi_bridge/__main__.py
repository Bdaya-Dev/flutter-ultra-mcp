"""``python -m atspi_bridge`` entrypoint.

Boots the bridge + desktop_api, registers handlers, and runs the stdio
JSON-RPC loop. Exposes the 11-method DesktopBackend surface (camelCase)
that mirrors the macOS Swift sidecar; the legacy snake_case primitives
from bridge.py are kept for direct/test consumers but not registered
with the TS-side server.
"""

from __future__ import annotations

import sys

from . import rpc
from .bridge import AtspiBridge
from .desktop_api import DesktopApi, build_handlers


def main() -> int:
    bridge = AtspiBridge()
    api = DesktopApi(bridge)
    handlers = build_handlers(api)

    if not bridge.is_available():
        rpc.write_log(
            "warn",
            "atspi binding unavailable — hello() will report helperPresent=False so TS side fails fast",
            error=bridge.availability_error(),
        )
    return rpc.run_loop(handlers)


if __name__ == "__main__":  # pragma: no cover — invoked as a module
    sys.exit(main())
