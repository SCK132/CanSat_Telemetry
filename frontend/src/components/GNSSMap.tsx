import { useEffect, useMemo } from 'react';
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { type TelemetryData } from '@cansat/shared';

interface GNSSMapProps {
  data: TelemetryData[];
}

function MapUpdater({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo(center, map.getZoom(), { duration: 0.5 });
  }, [center, map]);
  return null;
}

export function GNSSMap({ data }: GNSSMapProps) {
  const latest = data.at(-1);
  const currentFix = latest?.gnssFix && latest.latitude !== 0 && latest.longitude !== 0
    ? latest
    : undefined;
  const lastFix = [...data].reverse().find((item) =>
    item.gnssFix && item.latitude !== 0 && item.longitude !== 0);
  const shown = currentFix ?? lastFix;
  const latitude = shown?.latitude ?? 40.211;
  const longitude = shown?.longitude ?? 140.032;
  const center = useMemo<[number, number]>(
    () => [latitude, longitude],
    [latitude, longitude],
  );
  const status = currentFix ? 'FIX VALID' : lastFix ? 'LAST KNOWN POSITION' : 'NO FIX';

  return <div className="gnss-map">
    <div className={'gnss-map-status ' + (currentFix
      ? 'gnss-map-status--fix'
      : lastFix ? 'gnss-map-status--last' : '')}>{status}</div>
    <MapContainer center={center} zoom={18}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {shown ? <CircleMarker
        center={center}
        radius={currentFix ? 7 : 6}
        pathOptions={{
          color: currentFix ? '#45d6a1' : '#f2b84b',
          fillColor: currentFix ? '#45d6a1' : '#f2b84b',
          fillOpacity: currentFix ? 0.8 : 0.25,
          opacity: currentFix ? 1 : 0.65,
          dashArray: currentFix ? undefined : '4 3',
        }}
      >
        <Popup>
          {currentFix ? 'Current CanSat position' : 'Last known position'}<br />
          Lat: {center[0].toFixed(6)}<br />
          Lon: {center[1].toFixed(6)}<br />
          Satellites: {shown.satellites}
        </Popup>
      </CircleMarker> : null}
      <MapUpdater center={center} />
    </MapContainer>
  </div>;
}
