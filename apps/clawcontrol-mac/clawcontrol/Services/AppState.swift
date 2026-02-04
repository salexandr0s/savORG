import SwiftUI
import Combine

/// Connection state for the clawcontrol backend
enum ConnectionState: Equatable {
    case checking
    case connected
    case disconnected
}

/// Observable state manager for backend connectivity
@MainActor
class AppState: ObservableObject {
    @Published var connectionState: ConnectionState = .checking

    private var healthCheckTask: Task<Void, Never>?
    private let baseURL = URL(string: "http://127.0.0.1:3000/api/maintenance")!
    private let timeout: TimeInterval = 2.0

    init() {
        startHealthChecks()
    }

    deinit {
        healthCheckTask?.cancel()
    }

    /// Start the background health check loop
    func startHealthChecks() {
        healthCheckTask?.cancel()
        healthCheckTask = Task {
            await performHealthCheckLoop()
        }
    }

    /// Stop all health check tasks
    func stopHealthChecks() {
        healthCheckTask?.cancel()
    }

    /// Immediately retry the connection
    func retryNow() {
        connectionState = .checking
        Task {
            await checkHealth()
        }
    }

    /// Main health check loop - runs until cancelled
    private func performHealthCheckLoop() async {
        while !Task.isCancelled {
            await checkHealth()

            // Poll more frequently when disconnected
            let interval: UInt64 = connectionState == .connected ? 10_000_000_000 : 2_000_000_000
            try? await Task.sleep(nanoseconds: interval)
        }
    }

    /// Single health check request
    private func checkHealth() async {
        var request = URLRequest(url: baseURL)
        request.timeoutInterval = timeout
        request.httpMethod = "GET"

        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            if let httpResponse = response as? HTTPURLResponse,
               (200...299).contains(httpResponse.statusCode) {
                connectionState = .connected
            } else {
                connectionState = .disconnected
            }
        } catch {
            connectionState = .disconnected
        }
    }
}
