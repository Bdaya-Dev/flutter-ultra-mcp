// AXHandles.swift — stable round-trippable handles for AXUIElement.
//
// AXUIElement is a CFType ref; we cannot send the ref itself over JSON-RPC.
// Instead we keep an in-process LRU registry keyed by an opaque string id
// (a UUID); the client passes that id back when targeting elements.
//
// Handles are scoped to the helper's lifetime. If the helper restarts the
// client must call list_windows / dump_window_tree again to refresh ids.

import Foundation
import ApplicationServices

final class HandleRegistry {
    static let shared = HandleRegistry()

    private struct Slot {
        let element: AXUIElement
        let kind: String  // "window" or "element"
    }

    private var byId: [String: Slot] = [:]
    private let lock = NSLock()
    private let capacity = 8_192

    private init() {}

    func register(_ element: AXUIElement, kind: String) -> String {
        let id = "\(kind)_\(UUID().uuidString)"
        lock.lock()
        defer { lock.unlock() }
        if byId.count >= capacity {
            // Drop one arbitrary entry — these are weakly-referenced AX refs;
            // callers must re-discover after the drop.
            if let drop = byId.keys.first { byId.removeValue(forKey: drop) }
        }
        byId[id] = Slot(element: element, kind: kind)
        return id
    }

    func resolve(_ id: String) -> AXUIElement? {
        lock.lock()
        defer { lock.unlock() }
        return byId[id]?.element
    }

    func clear() {
        lock.lock()
        defer { lock.unlock() }
        byId.removeAll()
    }
}
