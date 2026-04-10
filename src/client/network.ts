import { ClientMessage, ServerMessage } from '../shared/protocol.js';

export type MessageHandler = (msg: ServerMessage) => void;

export class NetworkClient {
  private ws: WebSocket | null = null;
  private messageHandler: MessageHandler | null = null;
  private onConnectCb: (() => void) | null = null;
  private onDisconnectCb: (() => void) | null = null;

  connect(): void {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.onConnectCb?.();
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage;
        this.messageHandler?.(msg);
      } catch (err) {
        console.error('Failed to parse message:', err);
      }
    };

    this.ws.onclose = () => {
      console.log('WebSocket disconnected');
      this.onDisconnectCb?.();
    };

    this.ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  onConnect(cb: () => void): void {
    this.onConnectCb = cb;
  }

  onDisconnect(cb: () => void): void {
    this.onDisconnectCb = cb;
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
