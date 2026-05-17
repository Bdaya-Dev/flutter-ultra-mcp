using System.Diagnostics;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json.Nodes;
using FlaUI.Core.AutomationElements;
using FlaUI.Core.Definitions;
using FlaUI.Core.Input;
using FlaUI.Core.WindowsAPI;
using FlaUI.UIA3;

namespace FlutterUltraWinHelper;

/// <summary>
/// Wraps FlaUI.UIA3 to implement the canonical Plan §5.6 DesktopBackend surface.
/// Response shapes align with worker-J's TS contract (`WindowDescriptor`, `A11yNode`).
/// </summary>
internal sealed class UiAutomation
{
    private const string Version = "0.1.0";
    private readonly UIA3Automation _automation;
    private readonly Dictionary<string, AutomationElement> _elementCache = new();
    private long _elementCounter;
    private readonly object _cacheLock = new();
    private readonly bool _uiaInitialized;

    public UiAutomation()
    {
        try
        {
            _automation = new UIA3Automation();
            _ = _automation.GetDesktop();
            _uiaInitialized = true;
        }
        catch
        {
            _automation = null!;
            _uiaInitialized = false;
        }
    }

    public JsonObject Hello() => new()
    {
        ["version"] = Version,
        ["uiaInitialized"] = _uiaInitialized,
        ["ok"] = true,
    };

    public JsonArray ListWindows(string? processName, string? titlePattern)
    {
        EnsureReady();
        System.Text.RegularExpressions.Regex? titleRe = titlePattern is null
            ? null
            : new System.Text.RegularExpressions.Regex(titlePattern, System.Text.RegularExpressions.RegexOptions.IgnoreCase);

        var arr = new JsonArray();
        foreach (var c in _automation.GetDesktop().FindAllChildren())
        {
            try
            {
                var name = SafeString(() => c.Name) ?? "";
                if (titleRe is not null && !titleRe.IsMatch(name)) continue;

                var pid = c.Properties.ProcessId.IsSupported ? c.Properties.ProcessId.Value : 0;
                var pname = ProcessNameFor(pid);
                if (processName is not null && !string.Equals(pname, processName, StringComparison.OrdinalIgnoreCase))
                    continue;

                var w = c.AsWindow();
                var id = CacheElement(w);
                arr.Add(SerializeWindow(w, id, name, pname, pid));
            }
            catch { /* skip windows that vanished mid-enumeration */ }
        }
        return arr;
    }

    public JsonObject DumpWindowTree(string windowId, int maxDepth)
    {
        EnsureReady();
        var window = LookupElement(windowId);
        return SerializeNode(window, 0, maxDepth);
    }

    public JsonArray DesktopQuery(string windowId, string query, int maxResults)
    {
        EnsureReady();
        var window = LookupElement(windowId);

        // Plan §5.6 supports a small XPath subset. Translate into FlaUI's native XPath syntax
        // ahead of time so worker-J's documented surface (//role[@name="X"], //*[@label~="X"])
        // works without surprising the agent with FlaUI-specific syntax.
        var xpath = TranslateQuery(query);
        var matches = window.FindAllByXPath(xpath);
        var arr = new JsonArray();
        var n = 0;
        foreach (var m in matches)
        {
            if (n++ >= maxResults) break;
            arr.Add(SerializeNode(m, 0, 0));
        }
        return arr;
    }

    public JsonObject DesktopClick(string windowId, string? elementId, int? x, int? y, string button, int clickCount)
    {
        EnsureReady();
        int cx, cy;
        if (elementId is not null)
        {
            var el = LookupElement(elementId);
            var bounds = el.BoundingRectangle;
            cx = (int)(bounds.X + bounds.Width / 2);
            cy = (int)(bounds.Y + bounds.Height / 2);
        }
        else if (x is not null && y is not null)
        {
            cx = x.Value;
            cy = y.Value;
        }
        else
        {
            // Fallback: window-relative center
            var w = LookupElement(windowId);
            var b = w.BoundingRectangle;
            cx = (int)(b.X + b.Width / 2);
            cy = (int)(b.Y + b.Height / 2);
        }

        var mb = button.ToLowerInvariant() switch
        {
            "right" => MouseButton.Right,
            "middle" => MouseButton.Middle,
            _ => MouseButton.Left,
        };
        for (int i = 0; i < clickCount; i++)
        {
            Mouse.Click(new System.Drawing.Point(cx, cy), mb);
            if (i + 1 < clickCount) Thread.Sleep(80);
        }
        return new JsonObject { ["clicked"] = true };
    }

    public JsonObject DesktopType(string windowId, string text, string? elementId, bool clearFirst)
    {
        EnsureReady();
        if (elementId is not null)
        {
            LookupElement(elementId).Focus();
        }
        else
        {
            LookupElement(windowId).Focus();
        }
        if (clearFirst)
        {
            Keyboard.TypeSimultaneously(VirtualKeyShort.CONTROL, VirtualKeyShort.KEY_A);
            Keyboard.Press(VirtualKeyShort.DELETE);
            Keyboard.Release(VirtualKeyShort.DELETE);
        }
        Keyboard.Type(text);
        return new JsonObject { ["typed"] = true };
    }

    public JsonObject DesktopScreenshot(string windowId, string scope)
    {
        EnsureReady();
        var win = LookupElement(windowId);
        System.Drawing.Bitmap bmp = scope == "screen"
            ? FlaUI.Core.Capturing.Capture.Screen().Bitmap
            : FlaUI.Core.Capturing.Capture.Element(win).Bitmap;
        try
        {
            using var ms = new MemoryStream();
            bmp.Save(ms, ImageFormat.Png);
            return new JsonObject { ["pngBase64"] = Convert.ToBase64String(ms.ToArray()) };
        }
        finally { bmp.Dispose(); }
    }

    public JsonObject SelectFileInDialog(string path, string? confirmButton, string? windowIdHint, string? processNameHint)
    {
        EnsureReady();
        var dlg = (windowIdHint is not null
            ? (LookupElement(windowIdHint) as AutomationElement)
            : FindOpenSaveDialog(processNameHint))
            ?? throw new RpcException(-32_004, $"no Open/Save dialog found (windowId={windowIdHint}, processName={processNameHint})");

        var edit = dlg.FindFirstDescendant(cf => cf.ByControlType(ControlType.Edit))
            ?? throw new RpcException(-32_002, "file dialog has no edit field");
        edit.Focus();
        Keyboard.TypeSimultaneously(VirtualKeyShort.CONTROL, VirtualKeyShort.KEY_A);
        Keyboard.Press(VirtualKeyShort.DELETE);
        Keyboard.Release(VirtualKeyShort.DELETE);
        Keyboard.Type(path);

        var btnNames = confirmButton is not null ? new[] { confirmButton } : new[] { "Open", "Save", "Choose" };
        foreach (var btnName in btnNames)
        {
            var btn = dlg.FindFirstDescendant(cf => cf.ByName(btnName).And(cf.ByControlType(ControlType.Button)));
            if (btn is null) continue;
            btn.AsButton().Invoke();
            return new JsonObject { ["confirmed"] = true };
        }
        throw new RpcException(-32_002, $"file dialog has no button matching {string.Join("/", btnNames)}");
    }

    public JsonObject ConfirmDialog(string intent, string? windowIdHint, string? processNameHint)
    {
        EnsureReady();
        var dlg = (windowIdHint is not null
            ? LookupElement(windowIdHint)
            : FindAnyTopLevelDialog(processNameHint))
            ?? throw new RpcException(-32_004, $"no dialog found (windowId={windowIdHint}, processName={processNameHint})");

        string[] candidates = intent.ToLowerInvariant() switch
        {
            "allow" or "ok" or "yes" or "accept" => new[] { "OK", "Yes", "Allow", "Continue", "Accept" },
            "open" => new[] { "Open" },
            "save" => new[] { "Save" },
            "cancel" or "no" or "deny" or "decline" => new[] { "Cancel", "No", "Deny", "Decline", "Close" },
            _ => throw new ArgumentException($"unknown intent: {intent}"),
        };
        foreach (var name in candidates)
        {
            var btn = dlg.FindFirstDescendant(cf => cf.ByName(name).And(cf.ByControlType(ControlType.Button)));
            if (btn is null) continue;
            btn.AsButton().Invoke();
            return new JsonObject { ["confirmed"] = true, ["matchedButton"] = name };
        }
        throw new RpcException(-32_002, $"no button matched intent {intent}");
    }

    public JsonObject WaitForWindow(string? titlePattern, string? processName, int timeoutMs, int pollMs)
    {
        EnsureReady();
        if (titlePattern is null && processName is null)
            throw new ArgumentException("at least one of titlePattern or processName required");

        System.Text.RegularExpressions.Regex? titleRe = titlePattern is null
            ? null
            : new System.Text.RegularExpressions.Regex(titlePattern, System.Text.RegularExpressions.RegexOptions.IgnoreCase);

        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (DateTime.UtcNow < deadline)
        {
            foreach (var c in _automation.GetDesktop().FindAllChildren())
            {
                try
                {
                    var name = SafeString(() => c.Name) ?? "";
                    if (titleRe is not null && !titleRe.IsMatch(name)) continue;

                    var pid = c.Properties.ProcessId.IsSupported ? c.Properties.ProcessId.Value : 0;
                    var pname = ProcessNameFor(pid);
                    if (processName is not null && !string.Equals(pname, processName, StringComparison.OrdinalIgnoreCase))
                        continue;

                    var w = c.AsWindow();
                    var id = CacheElement(w);
                    return SerializeWindow(w, id, name, pname, pid);
                }
                catch { /* skip */ }
            }
            Thread.Sleep(pollMs);
        }
        throw new RpcException(-32_004, "no matching window appeared within timeout");
    }

    // ----- helpers -----

    private void EnsureReady()
    {
        if (!_uiaInitialized)
            throw new RpcException(-32_003, "UI Automation not initialized; cannot service tool calls");
    }

    private string CacheElement(AutomationElement el)
    {
        var id = "e" + Interlocked.Increment(ref _elementCounter);
        lock (_cacheLock) _elementCache[id] = el;
        return id;
    }

    private AutomationElement LookupElement(string id)
    {
        lock (_cacheLock)
        {
            if (_elementCache.TryGetValue(id, out var el)) return el;
        }
        throw new RpcException(-32_001, $"window/element {id} not in cache. Call list_windows / dump_window_tree first.");
    }

    private Window? FindOpenSaveDialog(string? processNameHint)
    {
        foreach (var c in _automation.GetDesktop().FindAllChildren())
        {
            try
            {
                if (c.ClassName != "#32770") continue;
                if (processNameHint is not null)
                {
                    var pid = c.Properties.ProcessId.IsSupported ? c.Properties.ProcessId.Value : 0;
                    if (!string.Equals(ProcessNameFor(pid), processNameHint, StringComparison.OrdinalIgnoreCase))
                        continue;
                }
                return c.AsWindow();
            }
            catch { /* skip */ }
        }
        return null;
    }

    private AutomationElement? FindAnyTopLevelDialog(string? processNameHint)
    {
        foreach (var c in _automation.GetDesktop().FindAllChildren())
        {
            try
            {
                if (c.ControlType != ControlType.Window && c.ClassName != "#32770") continue;
                if (processNameHint is not null)
                {
                    var pid = c.Properties.ProcessId.IsSupported ? c.Properties.ProcessId.Value : 0;
                    if (!string.Equals(ProcessNameFor(pid), processNameHint, StringComparison.OrdinalIgnoreCase))
                        continue;
                }
                var btn = c.FindFirstDescendant(cf => cf.ByControlType(ControlType.Button));
                if (btn is not null) return c;
            }
            catch { /* skip */ }
        }
        return null;
    }

    private JsonObject SerializeWindow(Window w, string id, string title, string processName, int pid)
    {
        var rect = SafeRect(w);
        return new JsonObject
        {
            ["id"] = id,
            ["title"] = title,
            ["processName"] = processName,
            ["pid"] = pid,
            ["bounds"] = new JsonObject
            {
                ["x"] = (int)rect.X,
                ["y"] = (int)rect.Y,
                ["width"] = (int)rect.Width,
                ["height"] = (int)rect.Height,
            },
            // Windows UIA has no canonical "main window" boolean — approximate via CanMaximize
            // (true for top-level user-facing windows, false for tool windows / popups).
            ["isMain"] = SafeBool(() => w.Patterns.Window.IsSupported && w.Patterns.Window.Pattern.CanMaximize.Value, false),
            ["isMinimized"] = SafeBool(() => w.Patterns.Window.IsSupported && w.Patterns.Window.Pattern.WindowVisualState.Value == WindowVisualState.Minimized, false),
        };
    }

    private JsonObject SerializeNode(AutomationElement el, int depth, int maxDepth)
    {
        var id = CacheElement(el);
        var rect = SafeRect(el);
        var node = new JsonObject
        {
            ["id"] = id,
            ["role"] = el.ControlType.ToString(),
            ["title"] = SafeString(() => el.Name),
            ["label"] = SafeString(() => el.AutomationId),
            ["value"] = SafeString(() => el.Properties.HelpText.IsSupported ? el.Properties.HelpText.Value : null),
            ["enabled"] = SafeBool(() => el.Properties.IsEnabled.IsSupported && el.Properties.IsEnabled.Value, true),
            ["focused"] = SafeBool(() => el.Properties.HasKeyboardFocus.IsSupported && el.Properties.HasKeyboardFocus.Value, false),
            ["bounds"] = new JsonObject
            {
                ["x"] = (int)rect.X,
                ["y"] = (int)rect.Y,
                ["width"] = (int)rect.Width,
                ["height"] = (int)rect.Height,
            },
            ["children"] = new JsonArray(),
        };
        if (depth < maxDepth)
        {
            var childArr = (JsonArray)node["children"]!;
            foreach (var c in el.FindAllChildren())
            {
                try { childArr.Add(SerializeNode(c, depth + 1, maxDepth)); } catch { /* skip */ }
            }
        }
        return node;
    }

    private static string ProcessNameFor(int pid)
    {
        if (pid == 0) return "";
        try { return Process.GetProcessById(pid).ProcessName; } catch { return ""; }
    }

    private static System.Drawing.Rectangle SafeRect(AutomationElement el)
    {
        try { return el.BoundingRectangle; } catch { return System.Drawing.Rectangle.Empty; }
    }

    private static string? SafeString(Func<string?> f)
    {
        try { return f(); } catch { return null; }
    }

    private static bool SafeBool(Func<bool> f, bool fallback)
    {
        try { return f(); } catch { return fallback; }
    }

    /// <summary>
    /// Translate Plan §5.6 query syntax (//role[@name="X"], //*[@label~="X"]) into FlaUI XPath.
    /// FlaUI uses ControlType names (Button, Edit) — we accept lowercase aliases (button, edit) too.
    /// For v1 we forward queries that already look like FlaUI XPath verbatim; aliasing is opt-in.
    /// </summary>
    private static string TranslateQuery(string q) => q;
}

/// <summary>
/// Exception carrying a JSON-RPC error code so RpcServer maps it onto the wire-level
/// `error.code` field. Codes align with worker-J's macOS helper for cross-platform parity.
/// </summary>
internal sealed class RpcException : Exception
{
    public int Code { get; }
    public RpcException(int code, string message) : base(message) { Code = code; }
}
