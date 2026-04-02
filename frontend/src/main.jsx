import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App';
import Dashboard from './Dashboard';
import NotFound from './NotFound';
import Register from './Register';
import SensorDetail from './SensorDetail';
import RaspiManagement from './RaspiManagement';
import 'leaflet/dist/leaflet.css';
import './index.css';
 
ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <Routes>
      <Route path="/ciren"                               element={<App />} />
      <Route path="/ciren/register"                      element={<Register />} />
      <Route path="/ciren/raspis"                        element={<RaspiManagement />} />
      <Route path="/ciren/dashboard"                     element={<Dashboard />} />
      <Route path="/ciren/:username/controller/:sensorID" element={<SensorDetail />} />
      <Route path="*"                                    element={<NotFound />} />
    </Routes>
  </BrowserRouter>
);
 