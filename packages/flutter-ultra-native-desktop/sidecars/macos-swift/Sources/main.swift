// main.swift — flutter-ultra-mac-helper entrypoint.
//
// Invoked by the @flutter-ultra/flutter-ultra-native-desktop MCP server
// as a stdio child. Speaks JSON-RPC 2.0 over stdin/stdout.
//
// Usage:
//   flutter-ultra-mac-helper --rpc        # JSON-RPC over stdio (production)
//   flutter-ultra-mac-helper --version    # print version + exit 0
//   flutter-ultra-mac-helper --probe-tcc  # print AX trust status + exit
//
// The --rpc flag is mandatory so a future `flutter-ultra-mac-helper run-once`
// or similar one-shot mode doesn't conflict. Today only --rpc is supported.

import Foundation
import AppKit

let args = CommandLine.arguments

if args.contains("--version") || args.contains("-v") {
    print(helperVersion)
    exit(0)
}

if args.contains("--probe-tcc") {
    let trusted = AXBridge.isAccessibilityTrusted(prompt: false)
    print(trusted ? "trusted" : "not_trusted")
    exit(trusted ? 0 : 1)
}

guard args.contains("--rpc") else {
    FileHandle.standardError.write(Data("Usage: flutter-ultra-mac-helper --rpc | --version | --probe-tcc\n".utf8))
    exit(64)  // EX_USAGE
}

helperLog(.info, "boot", extra: [
    "version": helperVersion,
    "pid": ProcessInfo.processInfo.processIdentifier,
    "axTrusted": AXBridge.isAccessibilityTrusted()
])

// Run loop owns the process. We start the RPC loop on a background thread
// so the main thread stays free for AppKit (CGEvent posting needs an
// active run loop, and several AX calls can call back into AppKit
// internals).
let rpc = RpcLoop()
DispatchQueue.global(qos: .userInitiated).async {
    rpc.run()
    // EOF on stdin: the parent MCP server has gone away; shut down.
    DispatchQueue.main.async { exit(0) }
}

// Pump the main run loop so CGEvent posts dispatch and Cocoa stays alive.
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
app.run()
