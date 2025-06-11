import { useEffect, useState } from 'react';
import axios from 'axios';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import './LiveDashboard.css';

const LiveDashboard = () => {
  const [data, setData] = useState([]);
  const [building, setBuilding] = useState('GebouwB');
  const [type, setType] = useState('timescale');
  const [warnings, setWarnings] = useState([]);

  const formatSensorData = (item) => ({
    time: new Date(item.timestamp).toLocaleTimeString(),
    rawTimestamp: new Date(item.timestamp).getTime(),
    co2: Math.round(item.co2),
    temperature: Number(item.temperature.toFixed(2)),
    pressure: Number(item.pressure.toFixed(1)),
    building: item.building,
    room: item.room,
  });

  useEffect(() => {
    setData([]);
    const fetchRecentData = async () => {
      try {
        const res = await axios.get('http://localhost:5001/api/sensordata/recent', {
          params: { building, type, count: 10 }
        });
        const formatted = res.data
          .map(formatSensorData)
          .sort((a, b) => a.rawTimestamp - b.rawTimestamp);
        setData(formatted);
      } catch (err) {
        console.error('❌ Fout bij ophalen initiële data:', err.message);
      }
    };
    fetchRecentData();
  }, [building, type]);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await axios.get('http://localhost:5001/api/sensordata/latest', {
          params: { building, type }
        });
        const latest = formatSensorData(res.data);
        setData(prev => {
          if (prev.length > 0 && latest.rawTimestamp <= prev[prev.length - 1].rawTimestamp) {
            return prev;
          }
          const combined = [...prev.slice(-19), latest];
          return combined.sort((a, b) => a.rawTimestamp - b.rawTimestamp);
        });
      } catch (err) {
        console.error('❌ Fout bij ophalen data:', err.message);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [building, type]);

  useEffect(() => {
    const highCo2Times = data
      .filter(d => d.co2 > 800)
      .map(d => d.time);

    setWarnings(highCo2Times);
  }, [data]);

  const latest = data[data.length - 1];

  return (
    <div className="container">
      <h2 className="title">📊 Live Sensor Dashboard</h2>

      <div className="controls">
        <label className="label">
          📍 <strong>Gebouw:</strong>
          <select className="select" value={building} onChange={e => setBuilding(e.target.value)}>
            <option value="GebouwA">Gebouw A (Centraal)</option>
            <option value="GebouwB">Gebouw B (Edge)</option>
          </select>
        </label>

        <label className="label">
          🛢️ <strong>Database:</strong>
          <select className="select" value={type} onChange={e => setType(e.target.value)}>
            <option value="mongo">MongoDB</option>
            <option value="cassandra">Cassandra</option>
            <option value="timescale">TimescaleDB</option>
          </select>
        </label>
      </div>

      {latest ? (
        <div className="latestMeasurement">
          <strong>Laatste meting:</strong><br />
          Tijd: {latest.time} <br />
          Gebouw: {latest.building} <br />
          Lokaal: {latest.room} <br />
          CO₂: {latest.co2} ppm<br />
          Temp: {latest.temperature} °C<br />
          Druk: {latest.pressure} hPa
        </div>
      ) : (
        <p>⏳ Wachten op sensordata...</p>
      )}

      {warnings.length > 0 && (
        <div style={{ color: 'red', fontWeight: 'bold', marginBottom: '1rem' }}>
          ⚠️ Waarschuwing: CO₂-niveau overschreden op {warnings.length} moment{warnings.length > 1 ? 'en' : ''}:<br />
          {warnings.map((t, i) => (
            <span key={i}>• {t}<br /></span>
          ))}
        </div>
      )}

      <ResponsiveContainer width="100%" height={400}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="time" />
          <YAxis />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="co2" stroke="#FF4136" name="CO₂ (ppm)" />
          <Line type="monotone" dataKey="temperature" stroke="#0074D9" name="Temperatuur (°C)" />
          <Line type="monotone" dataKey="pressure" stroke="#2ECC40" name="Luchtdruk (hPa)" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default LiveDashboard;