import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { App } from './App.js';
import { TripList } from './pages/TripList.js';
import { TripDetail } from './pages/TripDetail.js';
import { PlaceDetail } from './pages/PlaceDetail.js';
import { Itinerary } from './pages/Itinerary.js';
import { AddInfo } from './pages/AddInfo.js';
import { Settings } from './pages/Settings.js';
import { AccessHistory } from './pages/AccessHistory.js';
import { SharedTripGate } from './pages/SharedTripGate.js';
import { lockPageZoom } from './lib/lock-page-zoom.js';
import './styles.css';

// ページのピンチ/ダブルタップズームを抑止 (地図ズームは維持)。
lockPageZoom();

/** 旧 per-day プランナー (/trips/:tripId/days/:dayId) は旅のしおり (カンバン) に統合済み。後方互換でリダイレクト。 */
function DayRedirect() {
  const { tripId } = useParams<{ tripId: string }>();
  return <Navigate to={`/trips/${tripId}/itinerary`} replace />;
}

/** 旧 時刻表ページ (/trips/:tripId/transit) はマップ画面の左パネル「経路」モードに統合済み。後方互換でリダイレクト。 */
function TransitRedirect() {
  const { tripId } = useParams<{ tripId: string }>();
  return <Navigate to={`/trips/${tripId}?panel=transit`} replace />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />}>
          <Route index element={<AccessHistory />} />
          <Route path="trips" element={<TripList />} />
          <Route path="s/:token" element={<SharedTripGate />} />
          <Route path="settings" element={<Settings />} />
          <Route path="trips/:tripId" element={<TripDetail />} />
          <Route path="trips/:tripId/itinerary" element={<Itinerary />} />
          <Route path="trips/:tripId/add" element={<AddInfo />} />
          <Route path="trips/:tripId/transit" element={<TransitRedirect />} />
          <Route path="trips/:tripId/places/:placeId/add" element={<AddInfo />} />
          <Route path="trips/:tripId/places/:placeId" element={<PlaceDetail />} />
          <Route path="trips/:tripId/days/:dayId" element={<DayRedirect />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
