import { io } from "socket.io-client";

// Dengan Vite proxy, socket.io bisa connect ke origin yang sama (port 5173)
// dan di-proxy ke backend (port 3000) secara otomatis.
// Untuk production, set VITE_API_BASE ke URL backend.
const BACKEND = import.meta.env?.VITE_API_BASE || "";

export const socket = io(BACKEND || undefined, {
  path: "/socket.io",
  // WebSocket langsung — tidak ada polling-upgrade delay (~1-2 detik dihilangkan)
  transports: ["websocket", "polling"],
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  // Upgrade otomatis dimatikan karena kita sudah mulai dari WebSocket
  upgrade: false,
});

socket.on("connect", () =>
  console.log("[Socket] Connected:", socket.id, "via", socket.io.engine.transport.name)
);
socket.on("disconnect", (reason) =>
  console.warn("[Socket] Disconnected:", reason)
);
socket.on("connect_error", (err) =>
  console.error("[Socket] Error:", err.message)
);