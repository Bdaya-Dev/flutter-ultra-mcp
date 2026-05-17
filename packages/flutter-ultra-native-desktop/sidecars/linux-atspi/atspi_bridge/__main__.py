"""``python -m atspi_bridge`` entrypoint.

Boots the bridge, registers handlers, and runs the stdio JSON-RPC loop.
Catches BaseException so even fatal binding init failures emit a
structured response before exit — the TS server can then surface a
clean diagnostic instead of "process died with no output".
"""

from __future__ import annotations

import sys

from . import rpc
from .bridge import AtspiBridge, build_handlers


def main() -> int:
    bridge = AtspiBridge()
    handlers = build_handlers(bridge)

    if not bridge.is_available():
        rpc.write_log(
            "warn",
            "atspi binding unavailable — only status() will return useful data",
            error=bridge.availability_error(),
        )
    return rpc.run_loop(handlers)


if __name__ == "__main__":  # pragma: no cover — invoked as a module
    sys.exit(main())
