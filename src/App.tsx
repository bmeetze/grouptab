import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from './ui/components';
import Home from './screens/Home';
import CreateTrip from './screens/CreateTrip';
import TripGate from './screens/TripGate';

export default function App() {
  return (
    <BrowserRouter basename="/grouptab/">
      <ToastProvider>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/new" element={<CreateTrip />} />
          <Route path="/t/:slug/*" element={<TripGate />} />
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  );
}
