import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate, useLocation } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { PageNav } from '@/components/layout/PageNav';

function renderAt(entries: string[], initialIndex = entries.length - 1) {
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={initialIndex}>
      <Routes>
        <Route
          path="*"
          element={
            <PageNav trail={[{ label: 'Section', href: '/section' }, { label: 'Current' }]} />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PageNav (back safety + breadcrumbs)', () => {
  it('renders the Back button', () => {
    renderAt(['/foo']);
    expect(screen.getByTestId('pagenav-back')).toBeInTheDocument();
  });

  it('renders the Dashboard button pointing to /dashboard', () => {
    renderAt(['/foo']);
    const dash = screen.getByRole('link', { name: /go to dashboard/i });
    expect(dash).toHaveAttribute('href', '/dashboard');
  });

  it('renders breadcrumb trail with clickable parent and non-link current', () => {
    renderAt(['/foo']);
    const parent = screen.getByRole('link', { name: 'Section' });
    expect(parent).toHaveAttribute('href', '/section');
    // Current crumb has no link role
    expect(screen.queryByRole('link', { name: 'Current' })).toBeNull();
    expect(screen.getByText('Current')).toBeInTheDocument();
  });

  it('Back navigates to /dashboard when there is no safe history (direct entry)', () => {
    // MemoryRouter with a single initial entry => location.key === 'default'
    const seen: string[] = [];
    function Spy() {
      const loc = useLocation();
      seen.push(loc.pathname);
      return <PageNav />;
    }
    render(
      <MemoryRouter initialEntries={['/agency']}>
        <Routes>
          <Route path="/agency" element={<Spy />} />
          <Route path="/dashboard" element={<div>DASH</div>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId('pagenav-back'));
    expect(screen.getByText('DASH')).toBeInTheDocument();
  });

  it('Back uses navigate(-1) when safe in-app history exists', () => {
    function Pusher() {
      const navigate = useNavigate();
      return (
        <>
          <button onClick={() => navigate('/agency')}>go</button>
          <PageNav />
        </>
      );
    }
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<Pusher />} />
          <Route path="/agency" element={<Pusher />} />
        </Routes>
      </MemoryRouter>,
    );
    // Push a new entry so location.key !== 'default'
    fireEvent.click(screen.getAllByText('go')[0]);
    // Now we're at /agency with safe history; clicking back should pop, not jump to /dashboard via Link
    fireEvent.click(screen.getByTestId('pagenav-back'));
    // After pop we're back on /dashboard which still shows the "go" button
    expect(screen.getByText('go')).toBeInTheDocument();
  });
});

describe('Standalone authenticated pages include PageNav and correct breadcrumbs', () => {
  const cases: Array<{ file: string; mustContain: string[]; mustNotContain?: string[] }> = [
    { file: 'src/pages/AssistantDashboard.tsx', mustContain: ['PageNav'] },
    {
      file: 'src/pages/AgencyDashboard.tsx',
      mustContain: ["PageNav trail={[{ label: 'Agency' }]}"],
      // Agency breadcrumb must NOT chain through Assistant
      mustNotContain: ["label: 'Assistant', href: '/assistant' }, { label: 'Agency'"],
    },
    { file: 'src/pages/DriverAssistantControl.tsx', mustContain: ['PageNav'] },
    { file: 'src/pages/DriverWorkItems.tsx', mustContain: ['PageNav'] },
    { file: 'src/pages/DriverDelegationApprovals.tsx', mustContain: ['PageNav'] },
    { file: 'src/pages/AssistantLimitedSettings.tsx', mustContain: ['PageNav'] },
  ];

  for (const c of cases) {
    it(`${c.file} has expected nav wiring`, () => {
      const src = readFileSync(c.file, 'utf8');
      for (const s of c.mustContain) expect(src).toContain(s);
      for (const s of c.mustNotContain ?? []) expect(src).not.toContain(s);
    });
  }
});

describe('PageNav does not import business logic modules', () => {
  it('PageNav source stays presentation-only', () => {
    const src = readFileSync('src/components/layout/PageNav.tsx', 'utf8');
    expect(src).not.toMatch(/from ['"]@\/hooks\/(useAuth|useSubscription|useAgency|useAssistants)/);
    expect(src).not.toMatch(/from ['"]@\/integrations\/supabase/);
  });
});
