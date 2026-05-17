// Logging.swift — structured JSON-line stderr logging (mirrors the TS-side
// logger format) so MCP-server logs and helper logs interleave cleanly.

import Foundation

enum LogLevel: String {
    case debug
    case info
    case warn
    case error
}

func helperLog(_ level: LogLevel, _ msg: String, extra: [String: Any] = [:]) {
    var record: [String: Any] = [
        "ts": ISO8601DateFormatter.shared.string(from: Date()),
        "level": level.rawValue,
        "component": "flutter-ultra-mac-helper",
        "msg": msg
    ]
    for (k, v) in extra { record[k] = v }
    guard let data = try? JSONSerialization.data(withJSONObject: record, options: []) else { return }
    var line = data
    line.append(0x0A)  // \n
    FileHandle.standardError.write(line)
}

extension ISO8601DateFormatter {
    static let shared: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
}
