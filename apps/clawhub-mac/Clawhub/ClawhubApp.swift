import SwiftUI
import AppKit

@main
struct ClawHubApp: App {
    @StateObject private var appState = AppState()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(appState)
        }
        .commands {
            // Replace "New Window" with our custom actions
            CommandGroup(replacing: .newItem) {
                Button("Open in Browser") {
                    if let url = URL(string: "http://127.0.0.1:3000") {
                        NSWorkspace.shared.open(url)
                    }
                }
                .keyboardShortcut("o", modifiers: [.command, .shift])
            }

            // Add to View menu
            CommandGroup(after: .toolbar) {
                Button("Reload") {
                    NotificationCenter.default.post(name: .reloadWebView, object: nil)
                }
                .keyboardShortcut("r", modifiers: .command)

                Divider()

                Button("Retry Connection") {
                    appState.retryNow()
                }
                .keyboardShortcut("r", modifiers: [.command, .shift])
                .disabled(appState.connectionState == .connected)
            }
        }
        .defaultSize(width: 1200, height: 800)
    }
}
