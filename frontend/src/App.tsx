import { useTelemetry } from './hooks/useTelemetry';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { WCPP_CODES } from '@cansat/shared';
import { CanSat3D } from './components/CanSat3D';
import { GNSSMap } from './components/GNSSMap';

function App() {
  const { data, isConnected, sendCommand, latestDataRef } = useTelemetry('ws://localhost:8080');

  const currentData = data.length > 0 ? data[data.length - 1] : null;

  const handleDrive = (action: number) => {
    sendCommand({
      unit: WCPP_CODES.UNIT.CANSAT,
      component: WCPP_CODES.COMPONENT.MAIN,
      action
    });
  };

  return (
    <div className="min-h-screen p-6 text-slate-100">
      {/* Header */}
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-sky-400 to-indigo-400">
            WASA CanSat Ground Station
          </h1>
          <p className="text-slate-400 mt-1">Real-time Telemetry & Command Interface</p>
        </div>
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
          <span className="font-mono text-sm">{isConnected ? 'UPLINK ACTIVE' : 'DISCONNECTED'}</span>
        </div>
      </header>

      {/* Main Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        
        {/* Left Sidebar (Status & Controls) */}
        <div className="xl:col-span-1 flex flex-col gap-6">
          <div className="glass-panel">
            <h2 className="text-xl font-semibold mb-4">Flight Status</h2>
            <div className="space-y-4 font-mono">
              <div className="flex justify-between">
                <span className="text-slate-400">Time (TI)</span>
                <span className="text-sky-300">{currentData?.time?.toFixed(1) ?? '---'} s</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">State (ST)</span>
                <span className="text-sky-300">{currentData?.state ?? '---'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Ack Seq</span>
                <span className="text-emerald-400">{currentData?.ackSeq ?? '---'}</span>
              </div>
            </div>
          </div>

          <div className="glass-panel">
            <h2 className="text-xl font-semibold mb-4">Sensor Data</h2>
            <div className="space-y-4 font-mono">
              <div className="flex justify-between">
                <span className="text-slate-400">Altitude (AL)</span>
                <span className="text-indigo-300">{currentData?.altitude?.toFixed(2) ?? '---'} m</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Pressure (PR)</span>
                <span className="text-indigo-300">{currentData?.pressure?.toFixed(1) ?? '---'} hPa</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Temp (TE)</span>
                <span className="text-indigo-300">{currentData?.temperature?.toFixed(1) ?? '---'} °C</span>
              </div>
            </div>
          </div>

          <div className="glass-panel">
            <h2 className="text-xl font-semibold mb-4">GNSS Status</h2>
            <div className="space-y-4 font-mono">
              <div className="flex justify-between">
                <span className="text-slate-400">Latitude (LA)</span>
                <span className="text-indigo-300">{currentData?.latitude?.toFixed(6) ?? '---'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Longitude (LO)</span>
                <span className="text-indigo-300">{currentData?.longitude?.toFixed(6) ?? '---'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Satellites (SA)</span>
                <span className="text-indigo-300">{currentData?.satellites ?? '---'}</span>
              </div>
            </div>
          </div>

          <div className="glass-panel mt-auto">
             <h2 className="text-xl font-semibold mb-4">Manual Rover Control</h2>
             <div className="flex flex-col items-center gap-2">
               <button 
                 onClick={() => handleDrive(WCPP_CODES.ACTION.DRIVE_FORWARD)}
                 disabled={!isConnected}
                 className="w-16 h-16 bg-primary hover:bg-sky-500 text-slate-900 font-bold rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center"
               >
                 W
               </button>
               <div className="flex gap-2">
                 <button 
                   onClick={() => handleDrive(WCPP_CODES.ACTION.DRIVE_LEFT)}
                   disabled={!isConnected}
                   className="w-16 h-16 bg-primary hover:bg-sky-500 text-slate-900 font-bold rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center"
                 >
                   A
                 </button>
                 <button 
                   onClick={() => handleDrive(WCPP_CODES.ACTION.DRIVE_STOP)}
                   disabled={!isConnected}
                   className="w-16 h-16 bg-destructive hover:bg-red-500 text-white font-bold rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center text-xs"
                 >
                   STOP
                 </button>
                 <button 
                   onClick={() => handleDrive(WCPP_CODES.ACTION.DRIVE_RIGHT)}
                   disabled={!isConnected}
                   className="w-16 h-16 bg-primary hover:bg-sky-500 text-slate-900 font-bold rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center"
                 >
                   D
                 </button>
               </div>
               <button 
                 onClick={() => handleDrive(WCPP_CODES.ACTION.DRIVE_BACKWARD)}
                 disabled={!isConnected}
                 className="w-16 h-16 bg-primary hover:bg-sky-500 text-slate-900 font-bold rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center"
               >
                 S
               </button>
             </div>
          </div>
        </div>

        {/* Charts and 3D and Map */}
        <div className="xl:col-span-3 flex flex-col gap-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-[350px]">
             {/* 3D Model */}
             <div className="glass-panel flex flex-col h-full">
               <h2 className="text-lg font-semibold mb-4">Live 3D Orientation</h2>
               <div className="flex-1 rounded-lg overflow-hidden border border-slate-700 relative">
                 <CanSat3D dataRef={latestDataRef} />
               </div>
             </div>
             
             {/* GNSS Map */}
             <div className="glass-panel flex flex-col h-full">
               <h2 className="text-lg font-semibold mb-4">Live Location Map</h2>
               <div className="flex-1 rounded-lg overflow-hidden border border-slate-700 relative">
                 <GNSSMap data={data} />
               </div>
             </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-[250px]">
             {/* Altitude Profile */}
             <div className="glass-panel flex flex-col h-full">
               <h2 className="text-lg font-semibold mb-4">Altitude Profile</h2>
               <div className="flex-1">
                 <ResponsiveContainer width="100%" height="100%">
                   <LineChart data={data}>
                     <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                     <XAxis dataKey="time" stroke="#94a3b8" />
                     <YAxis stroke="#94a3b8" />
                     <Tooltip 
                       contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155' }}
                       itemStyle={{ color: '#38bdf8' }}
                     />
                     <Line type="monotone" dataKey="altitude" stroke="#38bdf8" strokeWidth={2} dot={false} isAnimationActive={false} />
                   </LineChart>
                 </ResponsiveContainer>
               </div>
             </div>

            {/* IMU Pitch/Roll History */}
            <div className="glass-panel flex flex-col h-full">
              <h2 className="text-lg font-semibold mb-4">IMU Pitch/Roll History</h2>
              <div className="flex-1">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="time" stroke="#94a3b8" />
                    <YAxis stroke="#94a3b8" />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155' }}
                      itemStyle={{ color: '#e2e8f0' }}
                    />
                    <Line type="monotone" dataKey="orientationX" name="Pitch" stroke="#f43f5e" strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="orientationY" name="Roll" stroke="#3b82f6" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
