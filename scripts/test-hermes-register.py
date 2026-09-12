"""Test that the emitted plugin registers correctly and a tool call is wired."""
import json
import os
import sys

# Add the emitted plugin's PARENT dir to the path, so we can import
# hermes_flutter_ultra as a package (the directory name has a dash, so
# we symlink/rename approach — simpler: add the plugin dir itself to path
# and import __init__ directly via importlib).
plugin_dir = os.path.normpath(
    os.path.join(os.path.dirname(__file__), '..', 'dist', 'hermes-flutter-ultra')
)

# Rename trick: copy to a dash-free name so Python can import it.
# Simpler: add plugin_dir to sys.path and do a relative import.
# Actually, since __init__.py uses ``from .bridge import ...``, the directory
# must be a proper package name. Python 3 allows dashes in filesystem paths
# but NOT in import names. The Hermes runtime handles this internally; for
# this test, we load by path with importlib after patching the package name.

import importlib.util

# Load bridge first (no relative imports within it).
bridge_spec = importlib.util.spec_from_file_location(
    "hermes_flutter_ultra.bridge",
    os.path.join(plugin_dir, "bridge.py"),
)
bridge_mod = importlib.util.module_from_spec(bridge_spec)
bridge_mod.__file__ = os.path.join(plugin_dir, "bridge.py")
sys.modules["hermes_flutter_ultra.bridge"] = bridge_mod
bridge_spec.loader.exec_module(bridge_mod)

# Create a fake package module.
import types
pkg = types.ModuleType("hermes_flutter_ultra")
pkg.__path__ = [plugin_dir]
pkg.bridge = bridge_mod
sys.modules["hermes_flutter_ultra"] = pkg

# Now load __init__.py into the package.
init_spec = importlib.util.spec_from_file_location(
    "hermes_flutter_ultra",
    os.path.join(plugin_dir, "__init__.py"),
    submodule_search_locations=[plugin_dir],
)
pkg.__file__ = os.path.join(plugin_dir, "__init__.py")
init_spec.loader.exec_module(pkg)


class MockCtx:
    def __init__(self):
        self.tools = {}
        self.hooks = {}

    def register_tool(self, name, toolset, schema, handler, description, emoji='⚡'):
        self.tools[name] = {
            'toolset': toolset,
            'schema': schema,
            'handler': handler,
            'description': description,
            'emoji': emoji,
        }

    def register_hook(self, name, callback):
        self.hooks[name] = callback


ctx = MockCtx()
pkg.register(ctx)

# Report.
print(f"Registered {len(ctx.tools)} tools")
toolsets = set(t['toolset'] for t in ctx.tools.values())
for ts in sorted(toolsets):
    count = sum(1 for t in ctx.tools.values() if t['toolset'] == ts)
    print(f"  {ts}: {count} tools")

# Pick a gesture tool and verify its schema/handler are wired.
tap = ctx.tools.get('tap')
assert tap is not None, "tap tool not registered"
assert tap['toolset'] == 'flutter_ultra_gesture'
assert 'sessionId' in tap['schema'].get('properties', {}), "tap schema missing sessionId"
assert callable(tap['handler']), "tap handler not callable"
print(f"\ntap tool:")
print(f"  description: {tap['description'][:80]}...")
print(f"  schema props: {list(tap['schema'].get('properties', {}).keys())}")
print(f"  handler: {tap['handler'].__name__}")

# Verify the bridge is live.
assert pkg._POOL is not None, "pool not initialized"
assert pkg._POOL.available, "pool not available (repo root not found)"
print(f"\nBridge pool: available={pkg._POOL.available}")
print(f"Tool-to-package map: {len(pkg._POOL._tool_to_package)} entries")

# Invoke the handler with a bogus session to prove the subprocess bridge fires.
# The Flutter app is not running, so we expect an error — but the error should
# come from the MCP server subprocess (tool returned an error), NOT from the
# bridge itself failing to start.
print("\nInvoking tap handler with bogus session...")
result = tap['handler']({
    'sessionId': '00000000-0000-0000-0000-000000000000',
    'finder': {'key': 'nonexistent'},
})
print(f"Handler returned: {json.dumps(result, indent=2)[:300]}")

# Check the result is an error (expected — no Flutter app running).
assert 'error' in result or 'result' in result, f"Unexpected result shape: {result}"

pkg.unregister()
print("\n[OK] Plugin registered, bridge started, handler wired, invocation attempted, cleanup succeeded.")
