using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace FlutterUltraWinHelper;

/// <summary>
/// Newline-delimited JSON-RPC 2.0 over stdin/stdout.
/// One JSON message per line on each direction. Notifications (no id) are accepted but never
/// emitted from the server — only responses to requests.
/// </summary>
internal sealed class RpcServer
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false,
    };

    private readonly RpcSurface _surface = new();
    private readonly object _writeLock = new();

    public async Task<int> RunAsync()
    {
        using var stdin = Console.OpenStandardInput();
        using var reader = new StreamReader(stdin, Encoding.UTF8);

        while (true)
        {
            string? line;
            try
            {
                line = await reader.ReadLineAsync().ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"sidecar_read_failure: {ex.Message}");
                return 3;
            }

            if (line is null) return 0;
            if (line.Length == 0) continue;

            _ = Task.Run(() => HandleAsync(line));
        }
    }

    private async Task HandleAsync(string line)
    {
        JsonNode? req;
        try
        {
            req = JsonNode.Parse(line);
        }
        catch (Exception ex)
        {
            WriteResponse(new JsonObject
            {
                ["jsonrpc"] = "2.0",
                ["id"] = null,
                ["error"] = new JsonObject
                {
                    ["code"] = -32700,
                    ["message"] = $"parse_error: {ex.Message}",
                },
            });
            return;
        }
        if (req is not JsonObject reqObj)
        {
            return;
        }

        var idNode = reqObj["id"];
        var method = reqObj["method"]?.GetValue<string>();
        var paramsNode = reqObj["params"];

        if (method is null)
        {
            WriteResponse(InvalidRequest(idNode, "missing method"));
            return;
        }

        try
        {
            var result = await _surface.InvokeAsync(method, paramsNode).ConfigureAwait(false);
            if (idNode is null) return; // notification
            WriteResponse(new JsonObject
            {
                ["jsonrpc"] = "2.0",
                ["id"] = idNode?.DeepClone(),
                ["result"] = result,
            });
        }
        catch (RpcMethodNotFoundException ex)
        {
            WriteResponse(new JsonObject
            {
                ["jsonrpc"] = "2.0",
                ["id"] = idNode?.DeepClone(),
                ["error"] = new JsonObject
                {
                    ["code"] = -32601,
                    ["message"] = ex.Message,
                },
            });
        }
        catch (RpcException ex)
        {
            WriteResponse(new JsonObject
            {
                ["jsonrpc"] = "2.0",
                ["id"] = idNode?.DeepClone(),
                ["error"] = new JsonObject
                {
                    ["code"] = ex.Code,
                    ["message"] = ex.Message,
                },
            });
        }
        catch (Exception ex)
        {
            WriteResponse(new JsonObject
            {
                ["jsonrpc"] = "2.0",
                ["id"] = idNode?.DeepClone(),
                ["error"] = new JsonObject
                {
                    ["code"] = -32000,
                    ["message"] = ex.Message,
                    ["data"] = new JsonObject
                    {
                        ["type"] = ex.GetType().FullName,
                    },
                },
            });
        }
    }

    private static JsonObject InvalidRequest(JsonNode? id, string message) => new()
    {
        ["jsonrpc"] = "2.0",
        ["id"] = id?.DeepClone(),
        ["error"] = new JsonObject
        {
            ["code"] = -32600,
            ["message"] = message,
        },
    };

    private void WriteResponse(JsonObject obj)
    {
        var json = obj.ToJsonString(JsonOpts);
        lock (_writeLock)
        {
            Console.Out.WriteLine(json);
            Console.Out.Flush();
        }
    }
}

internal sealed class RpcMethodNotFoundException : Exception
{
    public RpcMethodNotFoundException(string message) : base(message) { }
}
