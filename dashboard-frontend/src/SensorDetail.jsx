import { useParams, useNavigate, Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000', { transports: ['websocket'] });

function SensorDetail() {
  const { username, sensorID } = useParams();
  const navigate = useNavigate();

  const [raspiID, setRaspiID] = useState(null);
  const [controllerDataList, setControllerDataList] = useState([]);
  const [latestSensorData, setLatestSensorData] = useState(null);
  const [availableControllers, setAvailableControllers] = useState([]);
  const [limit, setLimit] = useState(10);

  useEffect(() => {
    fetch(`http://localhost:3000/api/resolve/${username}`)
      .then(res => res.json())
      .then(({ raspi_serial_id }) => {
        setRaspiID(raspi_serial_id);
        return fetch(`http://localhost:3000/api/data/${raspi_serial_id}`);
      })
      .then(res => res.json())
      .then(dataList => {
        console.log("dataList : ", dataList);

        const reversed = [...dataList].reverse();
        const selected = reversed
          .map(entry => {
            const match = entry.data.find(d => d.sensor_controller_id === parseInt(sensorID));
            return match ? { ...match, timestamp: entry.timestamp } : null;
          })
          .filter(Boolean);

        setControllerDataList(selected);
        setLatestSensorData(selected[0]);

        const latestEntry = dataList[0];
        if (latestEntry?.data) {
          const allIDs = latestEntry.data.map(d => d.sensor_controller_id);
          setAvailableControllers(allIDs);
        }
      })
      .catch(() => {
        alert('Data tidak ditemukan');
        navigate('/ciren');
      });
  }, [username, sensorID, navigate]);

  useEffect(() => {
    if (!raspiID) return;

    const listener = (newData) => {
      if (newData.raspi_serial_id === raspiID) {
        const found = newData.data.find(d => d.sensor_controller_id === parseInt(sensorID));
        if (found) {
          const enriched = { ...found, timestamp: newData.timestamp };
          setLatestSensorData(enriched);
          setControllerDataList(prev => [enriched, ...prev].slice(0, limit));
        }
      }
    };

    socket.on('connection', listener);
    return () => socket.off('new-data', listener);
  }, [raspiID, sensorID, limit]);

  if (!latestSensorData) return <p style={{ padding: '1rem' }}>⏳ Memuat data sensor controller...</p>;

  return (
    <div style={{
      padding: '1.5rem',
      fontFamily: 'Arial, sans-serif',
      backgroundColor: '#f9fafb',
      position: 'relative',
    }}>
      <h2 style={{
        fontSize: '1.75rem',
        marginBottom: '1rem',
        fontWeight: 'bold',
        color: '#0d47a1',
      }}>
        🔍 Detail Sensor #{sensorID}
      </h2>

      {/* Tombol Navigasi Controller */}
      <div style={{
        position: 'absolute',
        top: '1.5rem',
        right: '1.5rem',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.5rem',
      }}>
        {availableControllers.map(id => (
          <Link
            key={id}
            to={`/ciren/${username}/controller/${id}`}
            style={{
              padding: '6px 12px',
              backgroundColor: id === parseInt(sensorID) ? '#42a5f5' : '#e0e0e0',
              borderRadius: '6px',
              textDecoration: 'none',
              color: id === parseInt(sensorID) ? '#fff' : '#333',
              fontWeight: 'bold',
              boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
            }}
          >
            #{id}
          </Link>
        ))}
      </div>

      {/* Kartu Data Terbaru */}
      <div style={{
        backgroundColor: '#ffffff',
        padding: '1rem',
        borderRadius: '12px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
        marginTop: '2rem',
        marginBottom: '1.5rem',
      }}>
        <p style={{ fontSize: '0.95rem', marginBottom: '1rem' }}>
          <strong>📅 Waktu:</strong> {new Date(latestSensorData.timestamp).toLocaleString()}
        </p>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: '1rem',
        }}>
          {Object.entries(latestSensorData).map(([key, value]) =>
            key !== 'sensor_controller_id' && key !== 'timestamp' && (
              <div key={key} style={{
                backgroundColor: '#f1f8ff',
                borderRadius: '8px',
                padding: '0.75rem',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                boxShadow: '0 2px 6px rgba(0,0,0,0.05)',
              }}>
                <span style={{
                  fontSize: '0.9rem',
                  fontWeight: 'bold',
                  color: '#0d47a1',
                  marginBottom: '0.25rem',
                }}>{key}</span>
                <span style={{ fontSize: '1.2rem', fontWeight: '600', color: '#333' }}>{value}</span>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

export default SensorDetail;
