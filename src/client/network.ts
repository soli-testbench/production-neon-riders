import { ClientMessage, ServerMessage } from '../shared/protocol.js';

export type MessageHandler = (msg: ServerMessage) => void;
export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';
export type StatusCallback = (status: ConnectionStatus) => void;

const MAX_RECONNECT_ATTEMPTS = 10;
const BACKOFF_CAP_MS = 30000;

export class NetworkClient {
  private ws: WebSocket | null = null;
  private messageHandler: MessageHandler | null = null;
  private onConnectCb: (() => void) | null = null;
  private onDisconnectCb: (() => void) | null = null;
  private onStatusChangeCb: StatusCallback | null = null;
  private intentionalClose = false;
  private reconnectAttempts = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private status: ConnectionStatus = 'disconnected';

  connect(): void {
    this.intentionalClose = false;
    this.clearReconnectTimeout();
    this.setStatus('connecting');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.reconnectAttempts = 0;
      this.setStatus('connected');
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
      this.ws = null;
      this.setStatus('disconnected');
      this.onDisconnectCb?.();

      if (!this.intentionalClose) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.setStatus('disconnected');
      return;
    }

    const backoffMs = Math.min(1000 * Math.pow(2, this.reconnectAttempts), BACKOFF_CAP_MS);
    this.reconnectAttempts++;

    console.log(`Reconnecting in ${backoffMs}ms (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
    this.setStatus('connecting');

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, backoffMs);
  }

  manualReconnect(): void {
    this.reconnectAttempts = 0;
    this.connect();
  }

  private clearReconnectTimeout(): void {
    if (this.reconnectTimeout !== null) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.onStatusChangeCb?.(status);
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  getMaxReconnectAttempts(): number {
    return MAX_RECONNECT_ATTEMPTS;
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

  onStatusChange(cb: StatusCallback): void {
    this.onStatusChangeCb = cb;
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.clearReconnectTimeout();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
