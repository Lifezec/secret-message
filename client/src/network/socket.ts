import { WS_URL } from '../config';

export class SocketClient {
  private socket: WebSocket | null = null;
  private url: string;
  private username: string = '';
  private reconnectInterval: number = 3000;
  private isConnecting: boolean = false;
  private heartbeatTimer: any = null;

  // Callbacks
  private onMessageReceived: (data: any) => void = () => {};
  private onAuthResult: (success: boolean, error?: string) => void = () => {};
  private onStatusChange: (status: 'disconnected' | 'connecting' | 'connected') => void = () => {};

  constructor(url: string) {
    this.url = url;
  }

  public connect(
    username: string,
    onMessageReceived: (data: any) => void,
    onAuthResult: (success: boolean, error?: string) => void,
    onStatusChange: (status: 'disconnected' | 'connecting' | 'connected') => void
  ) {
    this.username = username;
    this.onMessageReceived = onMessageReceived;
    this.onAuthResult = onAuthResult;
    this.onStatusChange = onStatusChange;
    this.startConnection();
  }

  private startConnection() {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.isConnecting = true;
    this.onStatusChange('connecting');
    console.log(`Connecting to WebSocket: ${this.url}`);

    try {
      this.socket = new WebSocket(this.url);

      this.socket.onopen = () => {
        console.log('WebSocket connection opened');
        this.onStatusChange('connected');
        this.authenticate();
        this.startHeartbeat();
      };

      this.socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'auth_response') {
            this.onAuthResult(data.success, data.error);
          } else if (data.type === 'heartbeat_ack') {
            // Heartbeat acknowledged by server
          } else {
            this.onMessageReceived(data);
          }
        } catch (err) {
          console.error('Error parsing received WebSocket message:', err);
        }
      };

      this.socket.onclose = (event) => {
        console.log(`WebSocket connection closed: ${event.reason} (code: ${event.code})`);
        this.onStatusChange('disconnected');
        this.stopHeartbeat();
        
        // Auto-reconnect if not explicitly disconnected
        if (this.isConnecting || this.username) {
          setTimeout(() => this.startConnection(), this.reconnectInterval);
        }
      };

      this.socket.onerror = (err) => {
        console.error('WebSocket connection error:', err);
      };
    } catch (error) {
      console.error('Error starting WebSocket connection:', error);
      this.onStatusChange('disconnected');
      setTimeout(() => this.startConnection(), this.reconnectInterval);
    }
  }

  private authenticate() {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      console.log(`Authenticating as: ${this.username}`);
      this.socket.send(JSON.stringify({
        type: 'auth',
        username: this.username
      }));
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: 'heartbeat' }));
      }
    }, 25000); // 25 seconds heartbeat
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  public send(payload: any) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
    } else {
      console.warn('Socket not open, cannot send payload');
    }
  }

  public disconnect() {
    this.username = '';
    this.stopHeartbeat();
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  public isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }
}

// Single instance for global application use
export const socketClient = new SocketClient(WS_URL);
