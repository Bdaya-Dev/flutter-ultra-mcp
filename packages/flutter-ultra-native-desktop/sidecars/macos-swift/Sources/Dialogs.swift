// Dialogs.swift — high-level helpers for file-open/save dialogs and
// localized intent-based confirmation.
//
// File dialog flow: macOS file dialogs uniformly accept Cmd+Shift+G to open
// a "Go to folder" prompt; we paste the path there and press Enter. That's
// more robust across localizations than typing into the dialog's text
// field directly (the field's a11y label varies per app).

import Foundation
import ApplicationServices
import AppKit

enum Dialogs {
    /// Locate a dialog: prefer explicit windowId; else find a sheet/window
    /// on the application matching processName; else the frontmost app.
    static func findDialog(windowId: String?, processName: String?) throws -> AXUIElement {
        if let wid = windowId {
            guard let el = HandleRegistry.shared.resolve(wid) else {
                throw HelperError.windowNotFound(wid)
            }
            return el
        }
        let app: NSRunningApplication
        if let name = processName {
            guard let match = NSWorkspace.shared.runningApplications.first(where: {
                ($0.localizedName ?? "").localizedCaseInsensitiveContains(name)
            }) else { throw HelperError.windowNotFound("processName=\(name)") }
            app = match
        } else {
            guard let front = NSWorkspace.shared.frontmostApplication else {
                throw HelperError.windowNotFound("frontmost app")
            }
            app = front
        }
        let axApp = AXUIElementCreateApplication(app.processIdentifier)
        // Try the focused window first; many alerts attach as a sheet on it.
        var rawFocused: CFTypeRef?
        if AXUIElementCopyAttributeValue(axApp, kAXFocusedWindowAttribute as CFString, &rawFocused) == .success,
           let win = rawFocused {
            return win as! AXUIElement
        }
        // Fall back to the first window in the list.
        var rawWindows: CFTypeRef?
        if AXUIElementCopyAttributeValue(axApp, kAXWindowsAttribute as CFString, &rawWindows) == .success,
           let list = rawWindows as? [AXUIElement], let first = list.first {
            return first
        }
        throw HelperError.windowNotFound("no window on pid=\(app.processIdentifier)")
    }

    static func selectFileInDialog(
        path: String,
        confirmButton: String?,
        windowId: String?,
        processName: String?
    ) throws {
        guard AXBridge.isAccessibilityTrusted() else { throw HelperError.tccNotGranted }
        let dialog = try findDialog(windowId: windowId, processName: processName)
        // Cmd+Shift+G — open "Go to folder" prompt; works on Open/Save panels.
        postKeyChord(virtualKey: 0x05 /* G */, flags: [.maskCommand, .maskShift])
        // Brief settle delay so the secondary prompt appears.
        usleep(150_000)
        // Type the path via Unicode keystroke.
        let utf16 = Array(path.utf16)
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
        // Confirm path entry.
        postKey(virtualKey: 0x24 /* Return */)
        usleep(150_000)
        // Click the dialog's confirm button.
        let buttonName = confirmButton ?? "Open"
        try clickButton(in: dialog, label: buttonName)
    }

    static func confirmDialog(
        intent: String,
        windowId: String?,
        processName: String?
    ) throws -> String {
        guard AXBridge.isAccessibilityTrusted() else { throw HelperError.tccNotGranted }
        let dialog = try findDialog(windowId: windowId, processName: processName)
        // Each intent maps to a set of localized button titles we try in order.
        // English first; macOS uses these literal strings in most en-* alerts.
        // Apps that ship localized strings will need their localized title
        // added here over time.
        let candidates: [String]
        switch intent {
        case "allow": candidates = ["Allow", "OK", "Continue"]
        case "deny": candidates = ["Don't Allow", "Deny", "Cancel"]
        case "ok": candidates = ["OK", "Ok"]
        case "cancel": candidates = ["Cancel"]
        case "yes": candidates = ["Yes"]
        case "no": candidates = ["No"]
        case "open": candidates = ["Open"]
        case "save": candidates = ["Save"]
        default:
            throw HelperError.invalidParam("unknown intent: \(intent)")
        }
        for name in candidates {
            do {
                try clickButton(in: dialog, label: name)
                return name
            } catch HelperError.elementNotFound {
                continue
            }
        }
        throw HelperError.dialogTimeout("no button matching intent=\(intent)")
    }

    // Locate a button by visible label OR by AXTitle and click it.
    static func clickButton(in container: AXUIElement, label: String) throws {
        if let btn = findFirst(in: container, where: { el in
            var rawRole: CFTypeRef?
            guard AXUIElementCopyAttributeValue(el, kAXRoleAttribute as CFString, &rawRole) == .success,
                  let role = rawRole as? String,
                  role == kAXButtonRole as String else { return false }
            var rawTitle: CFTypeRef?
            if AXUIElementCopyAttributeValue(el, kAXTitleAttribute as CFString, &rawTitle) == .success,
               let title = rawTitle as? String, title == label { return true }
            var rawDesc: CFTypeRef?
            if AXUIElementCopyAttributeValue(el, kAXDescriptionAttribute as CFString, &rawDesc) == .success,
               let desc = rawDesc as? String, desc == label { return true }
            return false
        }) {
            let pressErr = AXUIElementPerformAction(btn, kAXPressAction as CFString)
            if pressErr != .success {
                throw HelperError.axFailure("press '\(label)'", pressErr)
            }
            return
        }
        throw HelperError.elementNotFound("button[label=\(label)]")
    }

    // BFS descent looking for the first element satisfying the predicate.
    private static func findFirst(in root: AXUIElement, where pred: (AXUIElement) -> Bool) -> AXUIElement? {
        var queue: [AXUIElement] = [root]
        var visited = 0
        let cap = 5_000
        while let cur = queue.first, visited < cap {
            queue.removeFirst()
            visited += 1
            if pred(cur) { return cur }
            var rawChildren: CFTypeRef?
            if AXUIElementCopyAttributeValue(cur, kAXChildrenAttribute as CFString, &rawChildren) == .success,
               let kids = rawChildren as? [AXUIElement] {
                queue.append(contentsOf: kids)
            }
        }
        return nil
    }

    // MARK: - waitForWindow

    static func waitForWindow(titlePattern: String?, processName: String?, timeoutMs: Int, pollMs: Int) throws -> WindowRecord {
        guard AXBridge.isAccessibilityTrusted() else { throw HelperError.tccNotGranted }
        let deadline = Date().addingTimeInterval(Double(timeoutMs) / 1000.0)
        var lastError: HelperError = HelperError.dialogTimeout("waitForWindow")
        while Date() < deadline {
            do {
                let windows = try AXBridge.listWindows(processName: processName, titlePattern: titlePattern)
                if let hit = windows.first { return hit }
            } catch let e as HelperError {
                lastError = e
            }
            usleep(useconds_t(pollMs * 1000))
        }
        throw lastError is HelperError ? lastError : HelperError.dialogTimeout("waitForWindow")
    }

    // MARK: - tiny key helpers

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
}
