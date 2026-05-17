using System.Text.Json.Nodes;

namespace FlutterUltraWinHelper;

/// <summary>
/// JSON-RPC method dispatcher. Names match the canonical Plan §5.6 surface in camelCase to
/// align with worker-J's TS DesktopBackend contract on Bdaya-Dev/flutter-ultra-mcp.
/// </summary>
internal sealed class RpcSurface
{
    private readonly UiAutomation _ui = new();

    public Task<JsonNode?> InvokeAsync(string method, JsonNode? paramsNode)
    {
        return method switch
        {
            "hello" => Task.FromResult<JsonNode?>(_ui.Hello()),

            "listWindows" => Task.FromResult<JsonNode?>(_ui.ListWindows(
                GetStringOrNull(paramsNode, "processName"),
                GetStringOrNull(paramsNode, "titlePattern"))),

            "dumpWindowTree" => Task.FromResult<JsonNode?>(_ui.DumpWindowTree(
                GetString(paramsNode, "windowId"),
                GetIntOrDefault(paramsNode, "maxDepth", 12))),

            "desktopQuery" => Task.FromResult<JsonNode?>(_ui.DesktopQuery(
                GetString(paramsNode, "windowId"),
                GetString(paramsNode, "query"),
                GetIntOrDefault(paramsNode, "maxResults", 50))),

            "desktopClick" => Task.FromResult<JsonNode?>(_ui.DesktopClick(
                GetString(paramsNode, "windowId"),
                GetStringOrNull(paramsNode, "elementId"),
                GetIntOrNull(paramsNode, "x"),
                GetIntOrNull(paramsNode, "y"),
                GetStringOrDefault(paramsNode, "button", "left"),
                GetIntOrDefault(paramsNode, "clickCount", 1))),

            "desktopType" => Task.FromResult<JsonNode?>(_ui.DesktopType(
                GetString(paramsNode, "windowId"),
                GetString(paramsNode, "text"),
                GetStringOrNull(paramsNode, "elementId"),
                GetBoolOrDefault(paramsNode, "clearFirst", false))),

            "desktopScreenshot" => Task.FromResult<JsonNode?>(_ui.DesktopScreenshot(
                GetString(paramsNode, "windowId"),
                GetStringOrDefault(paramsNode, "scope", "window"))),

            "selectFileInDialog" => Task.FromResult<JsonNode?>(_ui.SelectFileInDialog(
                GetString(paramsNode, "path"),
                GetStringOrNull(paramsNode, "confirmButton"),
                GetStringOrNull(paramsNode, "windowId"),
                GetStringOrNull(paramsNode, "processName"))),

            "confirmDialog" => Task.FromResult<JsonNode?>(_ui.ConfirmDialog(
                GetString(paramsNode, "intent"),
                GetStringOrNull(paramsNode, "windowId"),
                GetStringOrNull(paramsNode, "processName"))),

            "waitForWindow" => Task.FromResult<JsonNode?>(_ui.WaitForWindow(
                GetStringOrNull(paramsNode, "titlePattern"),
                GetStringOrNull(paramsNode, "processName"),
                GetIntOrDefault(paramsNode, "timeoutMs", 30_000),
                GetIntOrDefault(paramsNode, "pollMs", 250))),

            "shutdown" => Task.FromResult<JsonNode?>(null), // notification — ignore

            _ => throw new RpcMethodNotFoundException($"method not found: {method}"),
        };
    }

    private static string GetString(JsonNode? p, string key)
        => GetStringOrNull(p, key) ?? throw new ArgumentException($"missing required string param: {key}");

    private static string? GetStringOrNull(JsonNode? p, string key)
    {
        if (p is not JsonObject o || !o.TryGetPropertyValue(key, out var v) || v is null) return null;
        try { return v.GetValue<string>(); } catch { return null; }
    }

    private static string GetStringOrDefault(JsonNode? p, string key, string @default)
        => GetStringOrNull(p, key) ?? @default;

    private static int GetIntOrDefault(JsonNode? p, string key, int @default)
        => GetIntOrNull(p, key) ?? @default;

    private static int? GetIntOrNull(JsonNode? p, string key)
    {
        if (p is not JsonObject o || !o.TryGetPropertyValue(key, out var v) || v is null) return null;
        try { return v.GetValue<int>(); } catch { return null; }
    }

    private static bool GetBoolOrDefault(JsonNode? p, string key, bool @default)
    {
        if (p is not JsonObject o || !o.TryGetPropertyValue(key, out var v) || v is null) return @default;
        try { return v.GetValue<bool>(); } catch { return @default; }
    }
}
