// TEMPORARY Phase 1T-F3C carrier-only mobile QA harness. Deleted before completion.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

const root = path.resolve(__dirname, '..');

export default defineConfig({
  root: __dirname,
  server: { host: '127.0.0.1', port: 5211, fs: { allow: [root] } },
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@/hooks/settlements/useSettlementData', replacement: path.resolve(__dirname, 'mocks/useSettlementData.ts') },
      { find: '@/hooks/opportunities/useRecruiterProfile', replacement: path.resolve(__dirname, 'mocks/useRecruiterProfile.ts') },
      { find: '@/hooks/opportunities/useRecruiterBilling', replacement: path.resolve(__dirname, 'mocks/useRecruiterBilling.ts') },
      { find: '@/hooks/opportunities/useOpportunityApplications', replacement: path.resolve(__dirname, 'mocks/useOpportunityApplications.ts') },
      { find: 'sonner', replacement: path.resolve(__dirname, 'mocks/sonner.ts') },
      { find: '@', replacement: path.resolve(root, 'src') },
    ],
  },
});
