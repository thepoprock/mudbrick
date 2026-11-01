/**
 * Network play over the relay (apps/relay). The moving player's browser plays and sends the game
 * state on; everyone else waits. The original's simultaneous-move option is not ported.
 */
export interface NetMessage {
  type: string;
  text?: string;
  moving?: number;
  seat?: number;
  seats?: number[];
  message?: string;
}

export class NetLink {
  private socket: WebSocket;
  constructor(
    url: string,
    readonly room: string,
    readonly seat: number,
    onMessage: (m: NetMessage) => void,
  ) {
    this.socket = new WebSocket(url);
    this.socket.addEventListener('open', () => {
      this.socket.send(JSON.stringify({ type: 'join', room, seat }));
    });
    this.socket.addEventListener('message', (e) => {
      onMessage(JSON.parse(String(e.data)) as NetMessage);
    });
  }

  sendState(text: string, moving: number): void {
    this.socket.send(JSON.stringify({ type: 'state', text, moving }));
  }

  chat(text: string): void {
    this.socket.send(JSON.stringify({ type: 'chat', text }));
  }
}
