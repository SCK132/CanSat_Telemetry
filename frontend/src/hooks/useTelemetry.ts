import { useState, useEffect, useCallback, useRef } from 'react';
import { TelemetryData } from '@cansat/shared';
import throttle from 'lodash/throttle';

export function useTelemetry(url: string) {
  const [data, setData] = useState<TelemetryData[]>([]);
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  
  // Store the absolute latest data in a ref so CanSat3D can access it without triggering re-renders
  const latestDataRef = useRef<TelemetryData | null>(null);

  // Throttle the state update to prevent UI freezing (e.g. max 5Hz update)
  const throttledSetData = useCallback(
    throttle((newTelemetry: TelemetryData) => {
      setData((prev) => {
        const newData = [...prev, newTelemetry];
        return newData.length > 100 ? newData.slice(newData.length - 100) : newData;
      });
    }, 200),
    []
  );

  useEffect(() => {
    const ws = new WebSocket(url);

    ws.onopen = () => {
      setIsConnected(true);
      console.log('Connected to backend');
    };

    ws.onmessage = (event) => {
      try {
        const newTelemetry = JSON.parse(event.data) as TelemetryData;
        
        // Always update the ref immediately for 3D model
        latestDataRef.current = newTelemetry;
        
        // Update the React State throttled
        throttledSetData(newTelemetry);
      } catch (e) {
        console.error('Failed to parse telemetry', e);
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      console.log('Disconnected from backend');
    };

    setSocket(ws);

    return () => {
      ws.close();
    };
  }, [url]);

  const sendCommand = useCallback((command: any) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(command));
    } else {
      console.error('Cannot send command: WebSocket is not open');
    }
  }, [socket]);

  return { data, isConnected, sendCommand, latestDataRef };
}
