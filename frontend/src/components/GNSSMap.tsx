import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { TelemetryData } from '@cansat/shared';

// Fix for default Leaflet icon not showing in React apps
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconAnchor: [12, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

interface GNSSMapProps {
  data: TelemetryData[];
}

function MapUpdater({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo(center, map.getZoom());
  }, [center, map]);
  return null;
}

export function GNSSMap({ data }: GNSSMapProps) {
  // Get latest coordinates or default to Noshiro testing ground roughly
  const latestData = data.length > 0 ? data[data.length - 1] : null;
  const position: [number, number] = latestData && latestData.latitude !== 0 && latestData.longitude !== 0
    ? [latestData.latitude, latestData.longitude]
    : [40.211, 140.032]; // Default testing ground

  return (
    <div className="w-full h-full relative bg-slate-900/50 rounded-lg overflow-hidden border border-slate-700">
      <MapContainer center={position} zoom={18} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={position}>
          <Popup>
            CanSat Location <br />
            Lat: {position[0].toFixed(6)} <br />
            Lon: {position[1].toFixed(6)} <br />
            Satellites: {latestData?.satellites ?? 0}
          </Popup>
        </Marker>
        <MapUpdater center={position} />
      </MapContainer>
    </div>
  );
}
