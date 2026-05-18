// Dispatch.swift — JSON-RPC method dispatch table.
//
// Method names mirror the TS-side method names in src/backends/macos.ts.
// Each method extracts typed parameters, calls the matching backend, and
// returns a JSON-encodable result.

import Foundation

enum Dispatch {
    static func dispatch(method: String, params: [String: Any]) throws -> Any {
        switch method {
        case "hello":
            return [
                "version": helperVersion,
                "accessibilityTrusted": AXBridge.isAccessibilityTrusted(),
                "bundleId": Bundle.main.bundleIdentifier ?? "com.bdaya-dev.flutter-ultra-mac-helper"
            ]

        case "shutdown":
            // Notification — graceful exit on the main thread.
            DispatchQueue.main.async { exit(0) }
            return NSNull()

        case "listWindows":
            let processName = params["processName"] as? String
            let titlePattern = params["titlePattern"] as? String
            let windows = try AXBridge.listWindows(processName: processName, titlePattern: titlePattern)
            return try encode(windows)

        case "dumpWindowTree":
            guard let windowId = params["windowId"] as? String else { throw HelperError.invalidParam("windowId") }
            let maxDepth = params["maxDepth"] as? Int ?? 12
            return try encode(AXBridge.dumpWindowTree(windowId: windowId, maxDepth: maxDepth))

        case "desktopQuery":
            guard let windowId = params["windowId"] as? String else { throw HelperError.invalidParam("windowId") }
            guard let query = params["query"] as? String else { throw HelperError.invalidParam("query") }
            let maxResults = params["maxResults"] as? Int ?? 50
            return try encode(AXBridge.desktopQuery(windowId: windowId, query: query, maxResults: maxResults))

        case "desktopClick":
            guard let windowId = params["windowId"] as? String else { throw HelperError.invalidParam("windowId") }
            let elementId = params["elementId"] as? String
            let x = (params["x"] as? Double) ?? (params["x"] as? Int).map(Double.init)
            let y = (params["y"] as? Double) ?? (params["y"] as? Int).map(Double.init)
            let button = params["button"] as? String ?? "left"
            let clickCount = params["clickCount"] as? Int ?? 1
            try AXBridge.desktopClick(
                windowId: windowId,
                elementId: elementId,
                x: x,
                y: y,
                button: button,
                clickCount: clickCount
            )
            return ["clicked": true]

        case "desktopType":
            guard let windowId = params["windowId"] as? String else { throw HelperError.invalidParam("windowId") }
            guard let text = params["text"] as? String else { throw HelperError.invalidParam("text") }
            let elementId = params["elementId"] as? String
            let clearFirst = params["clearFirst"] as? Bool ?? false
            try AXBridge.desktopType(
                windowId: windowId,
                text: text,
                elementId: elementId,
                clearFirst: clearFirst
            )
            return ["typed": true]

        case "desktopScreenshot":
            guard let windowId = params["windowId"] as? String else { throw HelperError.invalidParam("windowId") }
            let scope = params["scope"] as? String ?? "window"
            let png = try Screenshot.capture(windowId: windowId, scope: scope)
            return ["pngBase64": png]

        case "selectFileInDialog":
            guard let path = params["path"] as? String else { throw HelperError.invalidParam("path") }
            let confirmButton = params["confirmButton"] as? String
            let windowId = params["windowId"] as? String
            let processName = params["processName"] as? String
            try Dialogs.selectFileInDialog(
                path: path,
                confirmButton: confirmButton,
                windowId: windowId,
                processName: processName
            )
            return ["confirmed": true]

        case "confirmDialog":
            guard let intent = params["intent"] as? String else { throw HelperError.invalidParam("intent") }
            let windowId = params["windowId"] as? String
            let processName = params["processName"] as? String
            let matched = try Dialogs.confirmDialog(intent: intent, windowId: windowId, processName: processName)
            return ["confirmed": true, "matchedButton": matched]

        case "waitForWindow":
            let titlePattern = params["titlePattern"] as? String
            let processName = params["processName"] as? String
            let timeoutMs = params["timeoutMs"] as? Int ?? 30_000
            let pollMs = params["pollMs"] as? Int ?? 250
            if pollMs <= 0 { throw HelperError.invalidParam("pollMs must be positive, got \(pollMs)") }
            if timeoutMs <= 0 { throw HelperError.invalidParam("timeoutMs must be positive, got \(timeoutMs)") }
            let win = try Dialogs.waitForWindow(
                titlePattern: titlePattern,
                processName: processName,
                timeoutMs: timeoutMs,
                pollMs: pollMs
            )
            return try encode(win)

        default:
            throw HelperError.unsupported("method=\(method)")
        }
    }

    private static func encode<T: Encodable>(_ value: T) throws -> Any {
        let data = try JSONEncoder().encode(value)
        return try JSONSerialization.jsonObject(with: data, options: [])
    }
}

let helperVersion = "0.0.1"
