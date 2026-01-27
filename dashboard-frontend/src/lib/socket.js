import { io } from "socket.io-client";

const API_BASE = import.meta.env?.VITE_API_BASE || "";
export const socket = io(API_BASE || undefined, {
  transports: ["websocket"],
});
