import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type { WsMessage } from "@palagg/shared";

const clients = new Set<WebSocket>();

export async function jobWsRoutes(app: FastifyInstance) {
  app.get("/ws/jobs", { websocket: true }, (socket) => {
    clients.add(socket);
    app.log.info(`WebSocket client connected (total: ${clients.size})`);

    socket.on("close", () => {
      clients.delete(socket);
      app.log.info(`WebSocket client disconnected (total: ${clients.size})`);
    });
  });
}

export function broadcast(message: WsMessage) {
  const data = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === 1) {
      client.send(data);
    }
  }
}
