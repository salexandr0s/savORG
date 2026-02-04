import SwiftUI
import WebKit

/// WKWebView wrapper with strict navigation security
/// Only allows navigation to http://127.0.0.1:3000 and http://localhost:3000
struct WebViewContainer: NSViewRepresentable {
    static let allowedHosts = ["127.0.0.1", "localhost"]
    static let allowedPort = 3000
    static let baseURL = URL(string: "http://127.0.0.1:3000")!

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.preferences.isElementFullscreenEnabled = true

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator

        // Store reference for reload functionality
        context.coordinator.webView = webView

        // Load the initial URL
        webView.load(URLRequest(url: Self.baseURL))

        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        // No dynamic updates needed
    }

    // MARK: - Coordinator

    class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        weak var webView: WKWebView?
        private var reloadObserver: NSObjectProtocol?

        override init() {
            super.init()
            setupReloadObserver()
        }

        deinit {
            if let observer = reloadObserver {
                NotificationCenter.default.removeObserver(observer)
            }
        }

        private func setupReloadObserver() {
            reloadObserver = NotificationCenter.default.addObserver(
                forName: .reloadWebView,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                self?.webView?.reload()
            }
        }

        // MARK: - Navigation Policy (Critical Security)

        /// Main navigation policy - enforces strict allowlist
        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            preferences: WKWebpagePreferences,
            decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.cancel, preferences)
                return
            }

            // Log form submissions to external URLs (shouldn't happen in clawcontrol)
            if navigationAction.navigationType == .formSubmitted && !isAllowedURL(url) {
                print("[Security] Blocked form submission to external URL: \(url)")
                decisionHandler(.cancel, preferences)
                return
            }

            if isAllowedURL(url) {
                decisionHandler(.allow, preferences)
            } else {
                // External links open in default browser
                if url.scheme == "http" || url.scheme == "https" {
                    NSWorkspace.shared.open(url)
                }
                decisionHandler(.cancel, preferences)
            }
        }

        /// Check if URL is on the allowlist
        /// Allows: http://127.0.0.1:3000/*, http://localhost:3000/*
        /// Also allows: blob:, data:, about:blank for web app functionality
        private func isAllowedURL(_ url: URL) -> Bool {
            guard let scheme = url.scheme else { return false }

            // Standard HTTP navigation
            if scheme == "http" {
                guard let host = url.host else { return false }
                let port = url.port ?? 80

                return WebViewContainer.allowedHosts.contains(host)
                    && port == WebViewContainer.allowedPort
            }

            // Special schemes for web app functionality
            switch scheme {
            case "blob":
                // blob: URLs include origin - validate it
                // Format: blob:http://127.0.0.1:3000/uuid
                let blobString = url.absoluteString
                return blobString.hasPrefix("blob:http://127.0.0.1:3000/")
                    || blobString.hasPrefix("blob:http://localhost:3000/")

            case "data":
                // Allow data: URLs for inline content (images, etc.)
                return true

            case "about":
                // Only allow about:blank (used for empty frames/popups)
                return url.absoluteString == "about:blank"

            case "javascript":
                // Block javascript: URLs - potential XSS vector
                return false

            case "file":
                // Block file:// URLs
                return false

            case "https":
                // Block all HTTPS (external sites)
                return false

            default:
                return false
            }
        }

        // MARK: - Popup Handling

        /// Block popups - load in main webview if allowed
        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            // Don't create popup windows
            // If the URL is allowed, load it in the main webview
            if let url = navigationAction.request.url, isAllowedURL(url) {
                webView.load(navigationAction.request)
            } else if let url = navigationAction.request.url,
                      url.scheme == "http" || url.scheme == "https" {
                // External link from popup - open in browser
                NSWorkspace.shared.open(url)
            }
            return nil
        }

        // MARK: - Navigation Events

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            // Navigation completed successfully
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            print("[WebView] Navigation failed: \(error.localizedDescription)")
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            print("[WebView] Provisional navigation failed: \(error.localizedDescription)")
        }
    }
}
