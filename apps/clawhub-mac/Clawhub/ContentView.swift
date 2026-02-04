import SwiftUI

/// Main container view - shows WebView when connected, error view when not
struct ContentView: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        ZStack {
            switch appState.connectionState {
            case .checking:
                CheckingConnectionView()

            case .connected:
                WebViewContainer()

            case .disconnected:
                DisconnectedView {
                    appState.retryNow()
                }
            }
        }
        .frame(minWidth: 800, minHeight: 600)
    }
}

/// Shown briefly while checking initial connection
struct CheckingConnectionView: View {
    var body: some View {
        VStack(spacing: 16) {
            ProgressView()
                .scaleEffect(1.5)

            Text("Connecting to ClawHub...")
                .font(.headline)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(nsColor: .windowBackgroundColor))
    }
}

#Preview {
    ContentView()
        .environmentObject(AppState())
}
