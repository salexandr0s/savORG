import SwiftUI

/// Shown when the clawcontrol backend is not reachable
struct DisconnectedView: View {
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: 24) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 64))
                .foregroundColor(.orange)

            VStack(spacing: 8) {
                Text("clawcontrol is not running")
                    .font(.title2)
                    .fontWeight(.semibold)

                Text("Start the backend server and try again")
                    .font(.body)
                    .foregroundColor(.secondary)
            }

            VStack(spacing: 12) {
                Button(action: onRetry) {
                    HStack {
                        Image(systemName: "arrow.clockwise")
                        Text("Retry")
                    }
                    .frame(minWidth: 100)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)

                Text("Expected at: http://127.0.0.1:3000")
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .textSelection(.enabled)
            }

            Divider()
                .frame(width: 200)
                .padding(.vertical, 8)

            VStack(alignment: .leading, spacing: 8) {
                Text("To start clawcontrol:")
                    .font(.caption)
                    .fontWeight(.medium)

                VStack(alignment: .leading, spacing: 4) {
                    CodeSnippet("cd apps/clawcontrol")
                    CodeSnippet("npm run start")
                }
            }
            .padding()
            .background(Color(nsColor: .controlBackgroundColor))
            .cornerRadius(8)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(nsColor: .windowBackgroundColor))
    }
}

/// Small code snippet display
struct CodeSnippet: View {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(.system(.caption, design: .monospaced))
            .foregroundColor(.primary)
            .textSelection(.enabled)
    }
}

#Preview {
    DisconnectedView {
        print("Retry tapped")
    }
    .frame(width: 600, height: 500)
}
