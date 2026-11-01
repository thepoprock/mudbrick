/**
 * Rooms for network play. A room holds the latest game state and who sits where. It reads nothing
 * of the game: the moving player's browser runs the round and sends the result on.
 *
 *   PORT=8787 npm start
 *
 * Client to server: `{ type: 'join', room, seat }`, `{ type: 'state', text, moving }`,
 * `{ type: 'chat', text }`. Server to client: `{ type: 'state', text, moving }`,
 * `{ type: 'seats', seats }`, `{ type: 'chat', seat, text }`, `{ type: 'error', message }`.
 */
import { WebSocketServer, type WebSocket } from 'ws';

interface Room {
  state: string | null;
  moving: number | null;
  seats: Map<number, WebSocket>;
}

const rooms = new Map<string, Room>();

function send(socket: WebSocket, message: unknown): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

function broadcastSeats(room: Room): void {
  const seats = [...room.seats.keys()];
  for (const s of room.seats.values()) send(s, { type: 'seats', seats });
}

const server = new WebSocketServer({ port: Number(process.env.PORT ?? 8787), maxPayload: 1 << 26 });

server.on('connection', (socket) => {
  let room: Room | null = null;
  let seat = -1;
  socket.on('message', (data) => {
    let m: { type?: string; room?: string; seat?: number; text?: string; moving?: number };
    try {
      m = JSON.parse(String(data)) as typeof m;
    } catch {
      return;
    }
    if (m.type === 'join' && typeof m.room === 'string' && typeof m.seat === 'number') {
      let r = rooms.get(m.room);
      if (!r) {
        r = { state: null, moving: null, seats: new Map() };
        rooms.set(m.room, r);
      }
      const held = r.seats.get(m.seat);
      if (held && held !== socket && held.readyState === held.OPEN) {
        send(socket, { type: 'error', message: `seat ${m.seat} is taken` });
        return;
      }
      room = r;
      seat = m.seat;
      r.seats.set(seat, socket);
      broadcastSeats(r);
      if (r.state !== null) send(socket, { type: 'state', text: r.state, moving: r.moving });
      return;
    }
    if (!room) return;
    if (m.type === 'state' && typeof m.text === 'string' && typeof m.moving === 'number') {
      room.state = m.text;
      room.moving = m.moving;
      for (const [s, other] of room.seats)
        if (s !== seat) send(other, { type: 'state', text: m.text, moving: m.moving });
    }
    if (m.type === 'chat' && typeof m.text === 'string') {
      for (const other of room.seats.values()) send(other, { type: 'chat', seat, text: m.text });
    }
  });
  socket.on('close', () => {
    if (room && room.seats.get(seat) === socket) {
      room.seats.delete(seat);
      broadcastSeats(room);
    }
  });
});
