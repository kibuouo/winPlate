# macOS Electron menubar transition

This private workspace owns the existing Electron-based macOS menu-bar controller, preload bridge, panel renderer, and their platform-neutral test doubles. The Windows Electron startup shell consumes only the exported controller and resolved panel paths while the native SwiftUI/AppKit replacement is designed.

It is transition evidence, not the future native application boundary. New macOS product UI belongs in the native app after its separate architecture and privacy review.
