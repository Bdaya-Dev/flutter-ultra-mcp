// AXBridge.swift — typed helpers over the C AX APIs.
//
// All AX calls happen here so the dispatch table stays declarative. Each
// wrapper either returns a typed value or throws a HelperError that maps
// to a JSON-RPC error code.

import Foundation
import ApplicationServices
import AppKit
import CoreGraphics

struct WindowRecord: Encodable {
    let id: String
    let title: String
    let processName: String
    let pid: Int32
    let bounds: Rect
    let isMain: Bool
    let isMinimized: Bool
}

struct NodeRecord: Encodable {
    let id: String
    let role: String
    let title: String?
    let label: String?
    let value: String?
    let enabled: Bool
    let focused: Bool
    let bounds: Rect
    let children: [NodeRecord]
}

struct Rect: Encodable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

enum AXBridge {
    static func isAccessibilityTrusted(prompt: Bool = false) -> Bool {
        let opt = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        let opts: CFDictionary = [opt: prompt] as CFDictionary
        return AXIsProcessTrustedWithOptions(opts)
    }

    // MARK: - Window enumeration

    static func listWindows(processName: String?, titlePattern: String?) throws -> [WindowRecord] {
        guard isAccessibilityTrusted() else { throw HelperError.tccNotGranted }
        let workspace = NSWorkspace.shared
        var out: [WindowRecord] = []
        for app in workspace.runningApplications {
            guard app.activationPolicy == .regular || app.activationPolicy == .accessory else { continue }
            if let filter = processName, !app.localizedName.flatMap({ $0.localizedCaseInsensitiveContains(filter) }).orFalse() { continue }
            let pid = app.processIdentifier
            let axApp = AXUIElementCreateApplication(pid)
            var rawWindows: CFTypeRef?
            let result = AXUIElementCopyAttributeValue(axApp, kAXWindowsAttribute as CFString, &rawWindows)
            if result == .apiDisabled { throw HelperError.tccNotGranted }
            if result != .success { continue }
            guard let windows = rawWindows as? [AXUIElement] else { continue }
            var mainWindow: AXUIElement? = nil
            var rawMain: CFTypeRef?
            if AXUIElementCopyAttributeValue(axApp, kAXMainWindowAttribute as CFString, &rawMain) == .success {
                mainWindow = (rawMain as! AXUIElement?)
            }
            for w in windows {
                let title = readString(w, kAXTitleAttribute) ?? ""
                if let pat = titlePattern, !title.localizedCaseInsensitiveContains(pat) { continue }
                let pos = readPoint(w, kAXPositionAttribute) ?? CGPoint.zero
                let size = readSize(w, kAXSizeAttribute) ?? CGSize.zero
                let isMain = (mainWindow.flatMap { CFEqual(w, $0) } ?? false)
                let minimized = readBool(w, kAXMinimizedAttribute) ?? false
                let id = HandleRegistry.shared.register(w, kind: "window")
                out.append(WindowRecord(
                    id: id,
                    title: title,
                    processName: app.localizedName ?? "(unknown)",
                    pid: pid,
                    bounds: Rect(x: Double(pos.x), y: Double(pos.y), width: Double(size.width), height: Double(size.height)),
                    isMain: isMain,
                    isMinimized: minimized
                ))
            }
        }
        return out
    }

    // MARK: - Tree dump

    static func dumpWindowTree(windowId: String, maxDepth: Int) throws -> NodeRecord {
        guard isAccessibilityTrusted() else { throw HelperError.tccNotGranted }
        guard let win = HandleRegistry.shared.resolve(windowId) else {
            throw HelperError.windowNotFound(windowId)
        }
        return walk(win, depth: 0, maxDepth: maxDepth)
    }

    private static func walk(_ el: AXUIElement, depth: Int, maxDepth: Int) -> NodeRecord {
        let role = readString(el, kAXRoleAttribute) ?? "AXUnknown"
        let title = readString(el, kAXTitleAttribute)
        let label = readString(el, kAXDescriptionAttribute)
        let value = readString(el, kAXValueAttribute)
        let enabled = readBool(el, kAXEnabledAttribute) ?? true
        let focused = readBool(el, kAXFocusedAttribute) ?? false
        let pos = readPoint(el, kAXPositionAttribute) ?? CGPoint.zero
        let size = readSize(el, kAXSizeAttribute) ?? CGSize.zero
        var children: [NodeRecord] = []
        if depth < maxDepth {
            var rawChildren: CFTypeRef?
            if AXUIElementCopyAttributeValue(el, kAXChildrenAttribute as CFString, &rawChildren) == .success,
               let kids = rawChildren as? [AXUIElement] {
                for kid in kids {
                    children.append(walk(kid, depth: depth + 1, maxDepth: maxDepth))
                }
            }
        }
        let id = HandleRegistry.shared.register(el, kind: "element")
        return NodeRecord(
            id: id,
            role: role,
            title: title,
            label: label,
            value: value,
            enabled: enabled,
            focused: focused,
            bounds: Rect(x: Double(pos.x), y: Double(pos.y), width: Double(size.width), height: Double(size.height)),
            children: children
        )
    }

    // MARK: - Query (XPath-style subset)
    //
    // Supported subset:
    //   //role                 — any descendant with that role
    //   //role[@name="X"]      — role + exact title match
    //   //*[@label~="X"]       — any descendant whose label CONTAINS X
    //   //role[@value~="X"]    — role + value CONTAINS X

    static func desktopQuery(windowId: String, query: String, maxResults: Int) throws -> [NodeRecord] {
        guard isAccessibilityTrusted() else { throw HelperError.tccNotGranted }
        guard let win = HandleRegistry.shared.resolve(windowId) else {
            throw HelperError.windowNotFound(windowId)
        }
        let predicate = try parseQuery(query)
        var matches: [NodeRecord] = []
        var queue: [(AXUIElement, Int)] = [(win, 0)]
        while !queue.isEmpty && matches.count < maxResults {
            let (el, depth) = queue.removeFirst()
            if depth > 0, predicate.matches(el) {
                matches.append(walk(el, depth: 0, maxDepth: 1))
            }
            var rawChildren: CFTypeRef?
            if AXUIElementCopyAttributeValue(el, kAXChildrenAttribute as CFString, &rawChildren) == .success,
               let kids = rawChildren as? [AXUIElement] {
                for kid in kids { queue.append((kid, depth + 1)) }
            }
        }
        return matches
    }

    // MARK: - Click

    static func desktopClick(
        windowId: String,
        elementId: String?,
        x: Double?,
        y: Double?,
        button: String,
        clickCount: Int
    ) throws {
        guard isAccessibilityTrusted() else { throw HelperError.tccNotGranted }
        let targetPoint: CGPoint
        if let eid = elementId {
            guard let el = HandleRegistry.shared.resolve(eid) else {
                throw HelperError.elementNotFound(eid)
            }
            let pos = readPoint(el, kAXPositionAttribute) ?? CGPoint.zero
            let size = readSize(el, kAXSizeAttribute) ?? CGSize.zero
            targetPoint = CGPoint(x: pos.x + size.width / 2, y: pos.y + size.height / 2)
        } else if let cx = x, let cy = y {
            targetPoint = CGPoint(x: cx, y: cy)
        } else if HandleRegistry.shared.resolve(windowId) != nil {
            throw HelperError.invalidParam("desktopClick requires elementId OR (x,y)")
        } else {
            throw HelperError.windowNotFound(windowId)
        }

        let (downType, upType) = mouseEventTypes(button: button)
        let mouseButton = mouseButtonValue(button: button)
        for i in 0..<clickCount {
            if let down = CGEvent(mouseEventSource: nil, mouseType: downType, mouseCursorPosition: targetPoint, mouseButton: mouseButton) {
                down.setIntegerValueField(.mouseEventClickState, value: Int64(i + 1))
                down.post(tap: .cghidEventTap)
            }
            if let up = CGEvent(mouseEventSource: nil, mouseType: upType, mouseCursorPosition: targetPoint, mouseButton: mouseButton) {
                up.setIntegerValueField(.mouseEventClickState, value: Int64(i + 1))
                up.post(tap: .cghidEventTap)
            }
        }
    }

    private static func mouseEventTypes(button: String) -> (CGEventType, CGEventType) {
        switch button {
        case "right": return (.rightMouseDown, .rightMouseUp)
        case "middle": return (.otherMouseDown, .otherMouseUp)
        default: return (.leftMouseDown, .leftMouseUp)
        }
    }

    private static func mouseButtonValue(button: String) -> CGMouseButton {
        switch button {
        case "right": return .right
        case "middle": return .center
        default: return .left
        }
    }

    // MARK: - Type text

    static func desktopType(
        windowId: String,
        text: String,
        elementId: String?,
        clearFirst: Bool
    ) throws {
        guard isAccessibilityTrusted() else { throw HelperError.tccNotGranted }
        if let eid = elementId {
            guard let el = HandleRegistry.shared.resolve(eid) else {
                throw HelperError.elementNotFound(eid)
            }
            AXUIElementSetAttributeValue(el, kAXFocusedAttribute as CFString, kCFBooleanTrue)
        }
        if clearFirst {
            // Cmd+A then Delete — universal "select-all + erase" on macOS.
            postKeyChord(virtualKey: 0x00 /* A */, flags: [.maskCommand])
            postKey(virtualKey: 0x33 /* Delete */)
        }
        // Use a single CGEvent.keyboardSetUnicodeString call per character
        // batch so non-ASCII text (e.g. CJK, RTL) goes through correctly.
        let utf16 = Array(text.utf16)
        utf16.withUnsafeBufferPointer { buf in
            if let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true) {
                down.keyboardSetUnicodeString(stringLength: buf.count, unicodeString: buf.baseAddress)
                down.post(tap: .cghidEventTap)
            }
            if let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) {
                up.keyboardSetUnicodeString(stringLength: buf.count, unicodeString: buf.baseAddress)
                up.post(tap: .cghidEventTap)
            }
        }
    }

    private static func postKey(virtualKey: CGKeyCode) {
        if let down = CGEvent(keyboardEventSource: nil, virtualKey: virtualKey, keyDown: true) {
            down.post(tap: .cghidEventTap)
        }
        if let up = CGEvent(keyboardEventSource: nil, virtualKey: virtualKey, keyDown: false) {
            up.post(tap: .cghidEventTap)
        }
    }

    private static func postKeyChord(virtualKey: CGKeyCode, flags: CGEventFlags) {
        if let down = CGEvent(keyboardEventSource: nil, virtualKey: virtualKey, keyDown: true) {
            down.flags = flags
            down.post(tap: .cghidEventTap)
        }
        if let up = CGEvent(keyboardEventSource: nil, virtualKey: virtualKey, keyDown: false) {
            up.flags = flags
            up.post(tap: .cghidEventTap)
        }
    }

    // MARK: - read helpers

    private static func readString(_ el: AXUIElement, _ attr: String) -> String? {
        var raw: CFTypeRef?
        guard AXUIElementCopyAttributeValue(el, attr as CFString, &raw) == .success else { return nil }
        if let s = raw as? String { return s }
        if let n = raw as? NSNumber { return n.stringValue }
        return nil
    }

    private static func readBool(_ el: AXUIElement, _ attr: String) -> Bool? {
        var raw: CFTypeRef?
        guard AXUIElementCopyAttributeValue(el, attr as CFString, &raw) == .success else { return nil }
        if let b = raw as? Bool { return b }
        if let n = raw as? NSNumber { return n.boolValue }
        return nil
    }

    private static func readPoint(_ el: AXUIElement, _ attr: String) -> CGPoint? {
        var raw: CFTypeRef?
        guard AXUIElementCopyAttributeValue(el, attr as CFString, &raw) == .success else { return nil }
        guard CFGetTypeID(raw!) == AXValueGetTypeID() else { return nil }
        var pt = CGPoint.zero
        AXValueGetValue(raw as! AXValue, .cgPoint, &pt)
        return pt
    }

    private static func readSize(_ el: AXUIElement, _ attr: String) -> CGSize? {
        var raw: CFTypeRef?
        guard AXUIElementCopyAttributeValue(el, attr as CFString, &raw) == .success else { return nil }
        guard CFGetTypeID(raw!) == AXValueGetTypeID() else { return nil }
        var sz = CGSize.zero
        AXValueGetValue(raw as! AXValue, .cgSize, &sz)
        return sz
    }
}

// MARK: - tiny XPath-subset parser

struct QueryPredicate {
    let role: String?        // nil = wildcard
    let nameExact: String?
    let labelContains: String?
    let valueContains: String?

    func matches(_ el: AXUIElement) -> Bool {
        if let r = role {
            var raw: CFTypeRef?
            guard AXUIElementCopyAttributeValue(el, kAXRoleAttribute as CFString, &raw) == .success,
                  let actual = raw as? String, actual == r else { return false }
        }
        if let want = nameExact {
            var raw: CFTypeRef?
            guard AXUIElementCopyAttributeValue(el, kAXTitleAttribute as CFString, &raw) == .success,
                  let actual = raw as? String, actual == want else { return false }
        }
        if let want = labelContains {
            var raw: CFTypeRef?
            guard AXUIElementCopyAttributeValue(el, kAXDescriptionAttribute as CFString, &raw) == .success,
                  let actual = raw as? String, actual.localizedCaseInsensitiveContains(want) else { return false }
        }
        if let want = valueContains {
            var raw: CFTypeRef?
            guard AXUIElementCopyAttributeValue(el, kAXValueAttribute as CFString, &raw) == .success,
                  let actual = raw as? String, actual.localizedCaseInsensitiveContains(want) else { return false }
        }
        return true
    }
}

func parseQuery(_ q: String) throws -> QueryPredicate {
    // Strip leading // (we always search descendants).
    var src = q
    if src.hasPrefix("//") { src.removeFirst(2) }
    // Split on '[' to separate the role from the predicate clause.
    let roleEnd = src.firstIndex(of: "[") ?? src.endIndex
    let role: String? = {
        let raw = String(src[..<roleEnd])
        if raw.isEmpty || raw == "*" { return nil }
        return raw
    }()
    var nameExact: String? = nil
    var labelContains: String? = nil
    var valueContains: String? = nil
    if roleEnd != src.endIndex {
        var pred = String(src[roleEnd...])
        guard pred.hasPrefix("["), pred.hasSuffix("]") else {
            throw HelperError.invalidParam("desktop_query: predicate must be in square brackets")
        }
        pred.removeFirst()
        pred.removeLast()
        // We accept only one predicate clause for now.
        if pred.hasPrefix("@name=") {
            nameExact = unquoteValue(String(pred.dropFirst("@name=".count)))
        } else if pred.hasPrefix("@label~=") {
            labelContains = unquoteValue(String(pred.dropFirst("@label~=".count)))
        } else if pred.hasPrefix("@value~=") {
            valueContains = unquoteValue(String(pred.dropFirst("@value~=".count)))
        } else {
            throw HelperError.invalidParam("desktop_query: only @name=, @label~=, @value~= predicates are supported")
        }
    }
    return QueryPredicate(
        role: role,
        nameExact: nameExact,
        labelContains: labelContains,
        valueContains: valueContains
    )
}

private func unquoteValue(_ raw: String) -> String {
    var s = raw
    if (s.hasPrefix("\"") && s.hasSuffix("\"")) || (s.hasPrefix("'") && s.hasSuffix("'")) {
        s.removeFirst()
        s.removeLast()
    }
    return s
}

private extension Optional where Wrapped == Bool {
    func orFalse() -> Bool { self ?? false }
}
