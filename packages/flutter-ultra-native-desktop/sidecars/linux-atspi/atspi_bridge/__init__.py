"""flutter-ultra AT-SPI bridge package.

A long-running stdio JSON-RPC sidecar invoked by the
@flutter-ultra/flutter-ultra-native-desktop MCP server. Holds a single
process-wide ``Atspi`` initialisation and translates JSON requests into
calls against ``gi.repository.Atspi``.

The TS server treats this process as opaque: line-delimited JSON requests
in, line-delimited JSON responses out, one request per line, ``id`` echoed
back. See ``rpc.py`` for framing.
"""

__version__ = "0.0.1"
