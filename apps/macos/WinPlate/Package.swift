// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "WinPlate",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "WinPlate", targets: ["WinPlate"])
    ],
    targets: [
        .executableTarget(
            name: "WinPlate",
            path: "Sources/WinPlate"
        ),
        .testTarget(
            name: "WinPlateTests",
            dependencies: ["WinPlate"],
            path: "Tests/WinPlateTests"
        )
    ]
)
