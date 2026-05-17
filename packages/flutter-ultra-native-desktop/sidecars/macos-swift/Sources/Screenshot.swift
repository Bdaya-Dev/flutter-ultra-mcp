// Screenshot.swift — CGWindowList-backed window / screen capture.
//
// Returns base64-encoded PNG bytes so the JSON-RPC frame stays self-contained.

import Foundation
import ApplicationServices
import CoreGraphics
import AppKit

enum Screenshot {
    static func capture(windowId: String, scope: String) throws -> String {
        guard AXBridge.isAccessibilityTrusted() else { throw HelperError.tccNotGranted }
        guard let win = HandleRegistry.shared.resolve(windowId) else {
            throw HelperError.windowNotFound(windowId)
        }
        // Find the on-screen rect for this AXWindow. AX doesn't surface a
        // window number directly so we cross-reference CGWindowList by pid
        // and bounds.
        var pidValue: pid_t = 0
        AXUIElementGetPid(win, &pidValue)
        var rawPos: CFTypeRef?
        AXUIElementCopyAttributeValue(win, kAXPositionAttribute as CFString, &rawPos)
        var pos = CGPoint.zero
        if let v = rawPos, CFGetTypeID(v) == AXValueGetTypeID() {
            AXValueGetValue(v as! AXValue, .cgPoint, &pos)
        }
        var rawSize: CFTypeRef?
        AXUIElementCopyAttributeValue(win, kAXSizeAttribute as CFString, &rawSize)
        var size = CGSize.zero
        if let v = rawSize, CFGetTypeID(v) == AXValueGetTypeID() {
            AXValueGetValue(v as! AXValue, .cgSize, &size)
        }
        let windowRect = CGRect(origin: pos, size: size)

        let captureRect: CGRect
        if scope == "screen" {
            // Find the NSScreen containing this window's center.
            let center = CGPoint(x: windowRect.midX, y: windowRect.midY)
            let screen = NSScreen.screens.first { NSPointInRect(NSPointFromCGPoint(center), $0.frame) }
            captureRect = screen?.frame ?? CGRect.null
        } else {
            captureRect = windowRect
        }

        let listOptions: CGWindowListOption = scope == "window"
            ? [.optionIncludingWindow]
            : [.optionOnScreenOnly, .excludeDesktopElements]
        let imageOptions: CGWindowImageOption = [.boundsIgnoreFraming, .bestResolution]
        // Hopefully resolve the canonical CG window number via CGWindowListCopyWindowInfo
        // by matching pid + bounds; fall back to a screen capture for the window's
        // bounds if no match.
        let cgWindowId: CGWindowID = scope == "window"
            ? findCGWindowId(pid: pidValue, bounds: windowRect) ?? kCGNullWindowID
            : kCGNullWindowID

        guard let img = CGWindowListCreateImage(captureRect, listOptions, cgWindowId, imageOptions) else {
            // Fallback: screen capture confined to the window bounds.
            guard let fb = CGWindowListCreateImage(
                windowRect,
                [.optionOnScreenOnly, .excludeDesktopElements],
                kCGNullWindowID,
                imageOptions
            ) else {
                throw HelperError.axFailure("CGWindowListCreateImage", AXError.failure)
            }
            return try encodePng(fb)
        }
        return try encodePng(img)
    }

    private static func findCGWindowId(pid: pid_t, bounds: CGRect) -> CGWindowID? {
        let info = CGWindowListCopyWindowInfo(
            [.optionOnScreenOnly, .excludeDesktopElements],
            kCGNullWindowID
        ) as? [[String: Any]] ?? []
        // Pick the window matching pid whose bounds overlap most with ours.
        var best: (CGWindowID, Double)? = nil
        for dict in info {
            guard let ownerPid = dict[kCGWindowOwnerPID as String] as? Int32, ownerPid == pid else { continue }
            guard let boundsDict = dict[kCGWindowBounds as String] as? [String: Any] else { continue }
            let r = CGRect(
                x: (boundsDict["X"] as? Double) ?? 0,
                y: (boundsDict["Y"] as? Double) ?? 0,
                width: (boundsDict["Width"] as? Double) ?? 0,
                height: (boundsDict["Height"] as? Double) ?? 0
            )
            let inter = r.intersection(bounds)
            let area = inter.isNull ? 0 : Double(inter.width * inter.height)
            if best == nil || area > (best?.1 ?? 0) {
                if let wn = dict[kCGWindowNumber as String] as? UInt32 {
                    best = (CGWindowID(wn), area)
                }
            }
        }
        return best?.0
    }

    private static func encodePng(_ image: CGImage) throws -> String {
        let bitmap = NSBitmapImageRep(cgImage: image)
        guard let pngData = bitmap.representation(using: .png, properties: [:]) else {
            throw HelperError.axFailure("PNG encoding", AXError.failure)
        }
        return pngData.base64EncodedString()
    }
}
