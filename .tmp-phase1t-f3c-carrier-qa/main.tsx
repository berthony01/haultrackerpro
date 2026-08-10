import React from 'react';
import { createRoot } from 'react-dom/client';
import '@/index.css';
import { CarrierSettlementsPanel } from '@/components/settlements/CarrierSettlementsPanel';

/**
 * Mirrors the accepted recruiter approved layout exactly:
 * outer `grid lg:grid-cols-[1.5fr_1fr] gap-6`, left child `min-w-0 space-y-6`.
 */
function App() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="px-4 py-5 max-w-7xl mx-auto w-full">
        <div className="grid lg:grid-cols-[1.5fr_1fr] gap-6">
          <div className="min-w-0 space-y-6">
            <CarrierSettlementsPanel onManagePlan={() => {}} />
          </div>
          <div className="space-y-6" />
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
