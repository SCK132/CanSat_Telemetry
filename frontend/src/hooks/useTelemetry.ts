import { useState, useEffect, useCallback, useRef } from 'react';
import { TelemetryData } from '@cansat/shared';
import throttle from 'lodash/throttle';

const RECONNECT_BASE_DELAY_MS = 500;
const RECONNECT_MAX_DELAY_MS = 10_000;
const STABLE_CONNECTION_MS = 10_000;

function getReconnectDelay(attempt: number) {
  const exponentialDelay = Math.min(
    RECONNECT_MAX_DELAY_MS,
    RECONNECT_BASE_DELAY_MS * 2 ** Math.min(attempt, 5),
  );
  const jitter = 0.8 + Math.random() * 0.4;
  return Math.round(exponentialDelay * jitter);
}

export function useTelemetry(url: string) {
  const [data, setData] = useState<TelemetryData[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const latestDataRef = useRef<TelemetryData | null>(null);

  const throttledSetData = useCallback(
    throttle((newTelemetry: TelemetryData) => {
      setData((previous) => {
        const next = [...previous, newTelemetry];
        return next.length > 100
          ? next.slice(next.length - 100)
          : next;
      });
    }, 200),
    [],
  );

  useEffect(() => {
    let disposed = false;
    let reconnectTimer: number | undefined;
    let stableConnectionTimer: number | undefined;
    let reconnectAttempt = 0;

    const clearReconnectTimer = () => {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    };

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer !== undefined || !navigator.onLine) return;

      const delay = getReconnectDelay(reconnectAttempt);
      reconnectAttempt += 1;
      console.warn(`WebSocket disconnected; reconnecting in ${delay} ms`);
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = undefined;
        connect();
      }, delay);
    };

    const connect = () => {
      if (disposed || !navigator.onLine) return;

      const currentSocket = socketRef.current;
      if (
        currentSocket?.readyState === WebSocket.CONNECTING ||
        currentSocket?.readyState === WebSocket.OPEN
      ) {
        return;
      }

      clearReconnectTimer();
      const ws = new WebSocket(url);
      socketRef.current = ws;

      ws.onopen = () => {
        if (disposed || socketRef.current !== ws) return;

        setIsConnected(true);
        console.log('Connected to backend');

        window.clearTimeout(stableConnectionTimer);
        stableConnectionTimer = window.setTimeout(() => {
          reconnectAttempt = 0;
        }, STABLE_CONNECTION_MS);
      };

      ws.onmessage = (event) => {
        if (disposed || socketRef.current !== ws) return;

        try {
          const telemetry = JSON.parse(event.data) as TelemetryData;

          latestDataRef.current = telemetry;
          throttledSetData(telemetry);
        } catch (error) {
          console.error('Failed to parse telemetry', error);
        }
      };

      ws.onerror = (event) => {
        if (disposed || socketRef.current !== ws) return;

        // The browser follows a fatal WebSocket error with `close`. Closing here
        // can turn a recoverable transport hiccup into a client-initiated drop.
        console.warn('WebSocket transport error; waiting for close', event);
      };

      ws.onclose = (event) => {
        window.clearTimeout(stableConnectionTimer);
        stableConnectionTimer = undefined;

        // Ignore a late close event from a socket that has already been replaced.
        if (socketRef.current !== ws) return;

        socketRef.current = null;
        setIsConnected(false);
        if (disposed) return;

        console.warn(
          `WebSocket closed (code=${event.code}, reason=${event.reason || 'none'})`,
        );
        scheduleReconnect();
      };
    };

    const reconnectWhenOnline = () => {
      reconnectAttempt = 0;
      connect();
    };

    const reconnectWhenVisible = () => {
      if (document.visibilityState === 'visible') connect();
    };

    window.addEventListener('online', reconnectWhenOnline);
    document.addEventListener('visibilitychange', reconnectWhenVisible);
    connect();

    return () => {
      disposed = true;
      clearReconnectTimer();
      window.clearTimeout(stableConnectionTimer);
      window.removeEventListener('online', reconnectWhenOnline);
      document.removeEventListener('visibilitychange', reconnectWhenVisible);

      const ws = socketRef.current;
      socketRef.current = null;

      if (ws) {
        ws.close(1000, 'Component unmounted');
      }

      throttledSetData.cancel();
    };
  }, [url, throttledSetData]);

  const sendCommand = useCallback((command: unknown) => {
    const socket = socketRef.current;

    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(command));
    } else {
      console.error('Cannot send command: WebSocket is not open');
    }
  }, []);

  return {
    data,
    isConnected,
    sendCommand,
    latestDataRef,
  };
}