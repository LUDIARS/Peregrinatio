import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { App } from './App.js';
import { TripList } from './pages/TripList.js';
import { TripDetail } from './pages/TripDetail.js';
import { PlaceDetail } from './pages/PlaceDetail.js';
import { DayPlanner } from './pages/DayPlanner.js';
import { Itinerary } from './pages/Itinerary.js';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />}>
          <Route index element={<TripList />} />
          <Route path="trips/:tripId" element={<TripDetail />} />
          <Route path="trips/:tripId/itinerary" element={<Itinerary />} />
          <Route path="trips/:tripId/places/:placeId" element={<PlaceDetail />} />
          <Route path="trips/:tripId/days/:dayId" element={<DayPlanner />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
