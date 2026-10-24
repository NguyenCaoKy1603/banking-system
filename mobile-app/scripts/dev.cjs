const { spawn } = require("node:child_process");
const path = require("node:path");

// 1. Thêm Android platform-tools vào PATH nếu chưa có
const platformTools = path.join(process.env.LOCALAPPDATA || "", "Android", "Sdk", "platform-tools");
if (process.env.PATH && !process.env.PATH.includes(platformTools)) {
  process.env.PATH = `${platformTools};${process.env.PATH}`;
}

// 2. Chuyển tiếp cổng cho Android Emulator
try {
  const { execSync } = require("node:child_process");
  execSync("adb reverse tcp:5000 tcp:5000", { stdio: "ignore" });
  execSync("adb reverse tcp:8081 tcp:8081", { stdio: "ignore" });
} catch {
  // Bỏ qua nếu chưa bật máy ảo Android
}

// 3. Đặt localhost để không bị chặn bảo mật Android
process.env.REACT_NATIVE_PACKAGER_HOSTNAME = "localhost";

// 4. Khởi chạy Expo
const args = ["expo", "start", "-c", ...process.argv.slice(2)];
const child = spawn("npx", args, {
  stdio: "inherit",
  shell: true,
  env: process.env,
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
