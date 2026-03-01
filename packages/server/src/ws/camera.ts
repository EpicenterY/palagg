import type { FastifyInstance } from "fastify";

export async function cameraWsRoutes(app: FastifyInstance) {
  app.get("/ws/camera/:printerId", { websocket: true }, (socket, req) => {
    const { printerId } = req.params as { printerId: string };
    app.log.info({ printerId }, "Camera WebSocket client connected");

    // TODO: Start camera proxy for this printer (Phase 4)
    // - Connect to RTSPS stream via ffmpeg
    // - Pipe MJPEG frames to this WebSocket

    socket.on("close", () => {
      app.log.info({ printerId }, "Camera WebSocket client disconnected");
      // TODO: Stop camera proxy if no more clients
    });
  });
}
