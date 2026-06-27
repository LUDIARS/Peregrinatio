import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { App } from './App.js';
import { TripList } from './pages/TripList.js';
import { TripDetail } from './pages/TripDetail.js';
import { PlaceDetail } from './pages/PlaceDetail.js';
import { Itinerary } from './pages/Itinerary.js';
import { AddInfo } from './pages/AddInfo.js';
import { Transit } from './pages/Transit.js';
import { Settings } from './pages/Settings.js';
import './styles.css';

/** 旧 per-day プランナー (/trips/:tripId/days/:dayId) は旅のしおり (カンバン) に統合済み。後方互換でリダイレクト。 */
function DayRedirect() {
  const { tripId } = useParams<{ tripId: string }>();
  return <Navigate to={`/trips/${tripId}/itinerary`} replace />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />}>
          <Route index element={<TripList />} />
          <Route path="settings" element={<Settings />} />
          <Route path="trips/:tripId" element={<TripDetail />} />
          <Route path="trips/:tripId/itinerary" element={<Itinerary />} />
          <Route path="trips/:tripId/add" element={<AddInfo />} />
          <Route path="trips/:tripId/transit" element={<Transit />} />
          <Route path="trips/:tripId/places/:placeId/add" element={<AddInfo />} />
          <Route path="trips/:tripId/places/:placeId" element={<PlaceDetail />} />
          <Route path="trips/:tripId/days/:dayId" element={<DayRedirect />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
