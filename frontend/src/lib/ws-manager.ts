import { useNetworkStore } from "../store/network";
import { resolveWsHttpBase } from "./api-origin";

/* ------------------------------------------------------------------ */
/*  WsManager — WebSocket wrapper with auto-reconnect                  */
/* ------------------------------------------------------------------ */

export type WsEventHandler = (data: unknown) => void;

export interface WsManagerOptions {
  /** WebSocket URL (ws:// or wss://) */
  url: string;
  /** Subprotocols (e.g. ["bearer", token]) */
  protocols?: string[];
  /** Maximum number of reconnect attempts (default: Infinity) */
  maxRetries?: number;
  /** Called when connection is established (including reconnects) */
  onOpen?: () => void;
  /** Called when connection is lost */
  onClose?: () => void;
  /** Called when a reconnect attempt is about to be made */
  onReconnecting?: (attempt: number, delay: number) => void;
}

export class WsManager {
  private ws: WebSocket | null = null;
  private url: string;
  private protocols: string[];
  private maxRetries: number;
  private retryCount = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private disposed = false;
  private listeners = new Map<string, Set<WsEventHandler>>();
  private onOpen?: () => void;
  private onClose?: () => void;
  private onReconnecting?: (attempt: number, delay: number) => void;
  private networkUnsubscribe?: () => void;

  constructor(options: WsManagerOptions) {
    this.url = options.url;
    this.protocols = options.protocols ?? [];
    this.maxRetries = options.maxRetries ?? Infinity;
    this.onOpen = options.onOpen;
    this.onClose = options.onClose;
    this.onReconnecting = options.onReconnecting;

    // Subscribe to network status changes
    this.networkUnsubscribe = useNetworkStore.subscribe((state) => {
      if (state.isOnline && !this.disposed && !this.intentionalClose && !this.isConnected()) {
        // Network came back — attempt reconnect immediately
        this.clearRetryTimer();
        this.retryCount = 0;
        this.connect();
      }
    });
  }

  /** Whether the WebSocket is currently open and ready */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Establish the WebSocket connection */
  connect(): void {
    if (this.disposed) return;
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) return;

    this.intentionalClose = false;

    try {
      this.ws = new WebSocket(this.url, this.protocols);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      if (this.disposed || this.intentionalClose) {
        this.ws?.close();
        this.ws = null;
        return;
      }
      this.retryCount = 0;
      this.onOpen?.();
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const type = data.type as string | undefined;
        // Emit to specific type listeners
        if (type) {
          const handlers = this.listeners.get(type);
          if (handlers) {
            for (const handler of handlers) handler(data);
          }
        }
        // Emit to wildcard listeners
        const wildcardHandlers = this.listeners.get("*");
        if (wildcardHandlers) {
          for (const handler of wildcardHandlers) handler(data);
        }
      } catch {
        // Non-JSON message — ignore
      }
    };

    this.ws.onclose = () => {
      if (this.intentionalClose || this.disposed) this.ws = null;
      this.onClose?.();
      if (!this.intentionalClose && !this.disposed) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      // onclose will fire after onerror, so reconnect is handled there
    };
  }

  /** Disconnect and don't reconnect. */
  disconnect(): void {
    this.intentionalClose = true;
    this.clearRetryTimer();
    if (this.ws) {
      // Only close when OPEN. If CONNECTING, leave socket to open then onopen will close it,
      // avoiding browser "WebSocket is closed before the connection is established" noise.
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close();
        this.ws = null;
      }
    }
  }

  /** Permanently dispose this manager (no more reconnects, clean up subscriptions). */
  dispose(): void {
    this.disposed = true;
    this.disconnect();
    this.listeners.clear();
    this.networkUnsubscribe?.();
  }

  /** Send a message (JSON-serialized). Silently drops if not connected. */
  send(data: unknown): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(typeof data === "string" ? data : JSON.stringify(data));
    return true;
  }

  /** Subscribe to a specific message type (or "*" for all messages). Returns unsubscribe fn. */
  on(type: string, handler: WsEventHandler): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(handler);
    return () => {
      this.listeners.get(type)?.delete(handler);
    };
  }

  /** Get the raw WebSocket instance (for readyState checks, etc.) */
  get raw(): WebSocket | null {
    return this.ws;
  }

  /* ---------------------------------------------------------------- */
  /*  Private                                                          */
  /* ---------------------------------------------------------------- */

  private scheduleReconnect(): void {
    if (this.disposed || this.intentionalClose) return;
    if (this.retryCount >= this.maxRetries) return;

    // Don't reconnect if offline — the network listener will handle it
    if (!useNetworkStore.getState().isOnline) return;

    const delay = Math.min(1000 * Math.pow(2, this.retryCount), 30000);
    this.onReconnecting?.(this.retryCount + 1, delay);
    this.retryTimer = setTimeout(() => {
      this.retryCount++;
      this.connect();
    }, delay);
  }

  private clearRetryTimer(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Helper: build WS URL from env                                      */
/* ------------------------------------------------------------------ */

export function buildWsUrl(path: string): string {
  const httpBase = resolveWsHttpBase();
  const base = httpBase
    ? httpBase.replace(/^http/, "ws")
    : (typeof window !== "undefined" ? window.location.origin.replace(/^http/, "ws") : "");
  return `${base}${path}`;
}
