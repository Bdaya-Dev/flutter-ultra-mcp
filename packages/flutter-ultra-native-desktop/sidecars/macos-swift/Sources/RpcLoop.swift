// RpcLoop.swift — JSON-RPC 2.0 newline-delimited framing on stdin/stdout.
//
// One reader thread; one writer (serial via NSLock). Each request id is
// echoed in the response; notifications carry no id and yield no response.

import Foundation

final class RpcLoop {
    private let stdin = FileHandle.standardInput
    private let stdout = FileHandle.standardOutput
    private let writeLock = NSLock()
    private var buffer = Data()

    func run() {
        helperLog(.info, "rpc loop start", extra: ["pid": ProcessInfo.processInfo.processIdentifier])
        while true {
            let chunk = stdin.availableData
            if chunk.isEmpty {
                helperLog(.info, "stdin EOF; exiting")
                return
            }
            buffer.append(chunk)
            while let nl = buffer.firstIndex(of: 0x0A) {
                let line = buffer.subdata(in: 0..<nl)
                buffer.removeSubrange(0...nl)
                if line.isEmpty { continue }
                handle(line: line)
            }
        }
    }

    private func handle(line: Data) {
        guard let obj = try? JSONSerialization.jsonObject(with: line, options: []) as? [String: Any] else {
            writeError(id: nil, code: -32_700, message: "parse error")
            return
        }
        let method = obj["method"] as? String ?? ""
        let params = obj["params"] as? [String: Any] ?? [:]
        let id = obj["id"]
        let isNotification = !(obj.keys.contains("id")) || id is NSNull
        // Dispatch on a background queue so a slow tool can't block the
        // reader. Bound concurrency at 4 to keep CPU/AX traffic sane.
        Dispatcher.shared.submit { [weak self] in
            guard let self = self else { return }
            do {
                let result = try Dispatch.dispatch(method: method, params: params)
                if isNotification { return }
                self.writeSuccess(id: id, result: result)
            } catch let e as HelperError {
                if isNotification { return }
                self.writeError(id: id, code: e.code, message: e.description)
            } catch {
                if isNotification { return }
                self.writeError(id: id, code: -32_603, message: "internal error: \(error)")
            }
        }
    }

    private func writeSuccess(id: Any?, result: Any) {
        var resp: [String: Any] = ["jsonrpc": "2.0", "result": result]
        if let id = id { resp["id"] = id }
        write(frame: resp)
    }

    private func writeError(id: Any?, code: Int, message: String) {
        var resp: [String: Any] = [
            "jsonrpc": "2.0",
            "error": ["code": code, "message": message]
        ]
        if let id = id { resp["id"] = id } else { resp["id"] = NSNull() }
        write(frame: resp)
    }

    private func write(frame: [String: Any]) {
        let data: Data
        do {
            data = try JSONSerialization.data(withJSONObject: frame, options: [])
        } catch {
            helperLog(.error, "JSON serialization failed", extra: ["error": "\(error)"])
            let fallback: [String: Any] = [
                "jsonrpc": "2.0",
                "id": frame["id"] ?? NSNull(),
                "error": ["code": -32603, "message": "internal error: response serialization failed"]
            ]
            if let fb = try? JSONSerialization.data(withJSONObject: fallback, options: []) {
                writeLock.lock()
                defer { writeLock.unlock() }
                var out = fb
                out.append(0x0A)
                stdout.write(out)
            }
            return
        }
        writeLock.lock()
        defer { writeLock.unlock() }
        var out = data
        out.append(0x0A)
        stdout.write(out)
    }
}

final class Dispatcher {
    static let shared = Dispatcher()
    private let queue = DispatchQueue(label: "flutter-ultra-mac.dispatch", attributes: .concurrent)
    private let semaphore = DispatchSemaphore(value: 4)

    func submit(_ block: @escaping () -> Void) {
        queue.async { [self] in
            self.semaphore.wait()
            defer { self.semaphore.signal() }
            block()
        }
    }
}
