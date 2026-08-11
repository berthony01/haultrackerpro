import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, Truck, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SEOHead from '@/components/SEOHead';
import { recruiterFeatureList, downloadRecruiterFeatureSheet } from '@/lib/recruiterFeatureList';
import { buildBreadcrumbSchema } from '@/lib/breadcrumbSchema';

export default function RecruiterFeatures() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen" style={{ background: 'hsl(220, 20%, 8%)' }}>
      <SEOHead
        title="Recruiter Features — Trucking Recruiter Platform | HaulTrackerPro"
        description="Trucking recruiter tools: structured opportunity posting (1 active free, up to 25 on paid plans), applicant tracking, driver referral tracking, contract workflow tools, and settlement statements on paid plans."
        path="/recruiter/features"
        jsonLd={buildBreadcrumbSchema([{ name: 'Home', path: '/' }, { name: 'For Recruiters', path: '/recruiters' }, { name: 'Recruiter Features', path: '/recruiter/features' }])}
      />
      <nav className="sticky top-0 z-50 border-b" style={{ background: 'hsl(220, 20%, 8%)', borderColor: 'hsl(220, 16%, 16%)' }}>
        <div className="max-w-6xl mx-auto flex items-center justify-between px-4 sm:px-6 h-16">
          <button onClick={() => navigate('/')} className="flex items-center gap-2">
            <Truck className="h-6 w-6" style={{ color: 'hsl(25, 95%, 53%)' }} />
            <span className="text-lg font-black tracking-tight" style={{ color: 'hsl(0, 0%, 100%)' }}>HaulTrackerPro</span>
          </button>
          <Button onClick={() => navigate('/auth?intent=recruiter')} className="text-sm font-bold rounded-xl px-5" style={{ background: 'hsl(25, 95%, 53%)', color: 'hsl(0, 0%, 100%)' }}>
            Recruiter Sign Up
          </Button>
        </div>
      </nav>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-12 sm:pt-20 pb-10">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-xs font-medium mb-6" style={{ color: 'hsl(220, 10%, 50%)' }}>
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider mb-3" style={{ background: 'hsl(25, 95%, 53%, 0.15)', color: 'hsl(25, 95%, 60%)' }}>
              <ShieldCheck className="h-3 w-3" /> For Recruiters
            </div>
            <h1 className="text-3xl sm:text-5xl font-black tracking-tight" style={{ color: 'hsl(0, 0%, 100%)' }}>
              Recruiter <span style={{ color: 'hsl(25, 95%, 53%)' }}>Features</span>
            </h1>
            <p className="mt-3 text-base max-w-lg" style={{ color: 'hsl(220, 10%, 55%)' }}>
              Everything HaulTrackerPro gives active recruiters — from profile setup and posting to settlements and billing.
            </p>
          </div>
          <Button onClick={downloadRecruiterFeatureSheet} variant="outline" className="gap-2 rounded-xl font-bold shrink-0" style={{ borderColor: 'hsl(220, 16%, 22%)', color: 'hsl(220, 10%, 70%)', background: 'transparent' }}>
            <Download className="h-4 w-4" /> Download Feature Sheet
          </Button>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-20 space-y-14">
        {recruiterFeatureList.map((cat) => (
          <div key={cat.category}>
            <h2 className="text-xl sm:text-2xl font-black tracking-tight mb-4" style={{ color: 'hsl(0, 0%, 100%)' }}>
              {cat.category}
            </h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {cat.features.map((f) => (
                <div key={f.title} className="p-5 rounded-2xl border" style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(220, 16%, 16%)' }}>
                  <div className="h-10 w-10 rounded-xl flex items-center justify-center mb-3" style={{ background: 'hsl(25, 95%, 53%, 0.12)' }}>
                    <f.icon className="h-5 w-5" style={{ color: 'hsl(25, 95%, 53%)' }} />
                  </div>
                  <h3 className="text-sm font-bold mb-1.5" style={{ color: 'hsl(0, 0%, 100%)' }}>{f.title}</h3>
                  <p className="text-sm leading-relaxed" style={{ color: 'hsl(220, 10%, 55%)' }}>{f.description}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-16">
        <div className="p-6 sm:p-8 rounded-2xl border text-center" style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(220, 16%, 16%)' }}>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight mb-2" style={{ color: 'hsl(0, 0%, 100%)' }}>
            Ready to reach profit-focused drivers?
          </h2>
          <p className="text-sm mb-6 max-w-2xl mx-auto" style={{ color: 'hsl(220, 10%, 55%)' }}>
            Apply for recruiter access, get verified, and start posting structured opportunities.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button onClick={() => navigate('/auth?intent=recruiter')} className="rounded-xl font-bold gap-2" style={{ background: 'hsl(25, 95%, 53%)', color: 'hsl(0, 0%, 100%)' }}>
              Apply for Recruiter Access
            </Button>
            <Button onClick={() => navigate('/recruiter/faq')} variant="outline" className="rounded-xl font-bold" style={{ borderColor: 'hsl(220, 16%, 22%)', color: 'hsl(220, 10%, 70%)', background: 'transparent' }}>
              Recruiter FAQ
            </Button>
          </div>
          <p className="text-sm mt-5" style={{ color: 'hsl(220, 10%, 55%)' }}>
            Want the full breakdown?{' '}
            <button onClick={() => navigate('/resources/trucking-recruiter-tools')} className="font-semibold hover:underline" style={{ color: 'hsl(25, 95%, 60%)' }}>
              Read the trucking recruiter tools guide →
            </button>
          </p>
        </div>
      </section>

      <footer className="border-t py-8" style={{ borderColor: 'hsl(220, 16%, 14%)', background: 'hsl(220, 20%, 6%)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="text-xs" style={{ color: 'hsl(220, 10%, 40%)' }}>© {new Date().getFullYear()} HaulTrackerPro. All rights reserved.</span>
          <div className="flex items-center gap-5 flex-wrap justify-center">
            {[
              { label: 'For Recruiters', href: '/recruiters' },
              { label: 'Recruiter Features', href: '/recruiter/features' },
              { label: 'Recruiter Guide', href: '/recruiter/guide' },
              { label: 'Recruiter FAQ', href: '/recruiter/faq' },
              { label: 'Recruiter Updates', href: '/recruiter/updates' },
              { label: 'Pricing', href: '/pricing' },
              { label: 'About', href: '/about' },
              { label: 'Resources', href: '/resources' },
              { label: 'Terms', href: '/terms' },
              { label: 'Privacy', href: '/privacy' },
            ].map(link => (
              <a key={link.href} href={link.href} className="text-xs font-medium hover:underline" style={{ color: 'hsl(220, 10%, 50%)' }}>{link.label}</a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
