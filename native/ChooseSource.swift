import AppKit
import Foundation
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let panel = NSOpenPanel()
let kind = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "folder"
panel.title = kind == "folder" ? "选择 Markdown 资料文件夹" : "选择 Markdown 文件"
panel.prompt = "添加资料"
panel.canChooseFiles = kind != "folder"
panel.canChooseDirectories = kind == "folder"
panel.allowsMultipleSelection = kind != "folder"
panel.canCreateDirectories = false
if kind != "folder" { panel.allowedFileTypes = ["md", "markdown"] }
app.activate(ignoringOtherApps: true)
let response = panel.runModal()
let paths = response == .OK ? panel.urls.map { $0.path } : []
let data = try JSONSerialization.data(withJSONObject: paths)
print(String(data:data,encoding:.utf8)!)
