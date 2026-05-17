using System.Text;

namespace FlutterUltraWinHelper;

internal static class Program
{
    private static async Task<int> Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "--version")
        {
            Console.WriteLine("0.1.0");
            return 0;
        }

        Console.OutputEncoding = Encoding.UTF8;
        Console.InputEncoding = Encoding.UTF8;

        var server = new RpcServer();
        return await server.RunAsync().ConfigureAwait(false);
    }
}
