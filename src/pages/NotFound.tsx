import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import SEOHead from '@/components/SEOHead';

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="dark flex min-h-screen items-center justify-center bg-background px-4">
      <SEOHead title="Page Not Found | HaulTrackerPro" description="Page not found." path="/404" noindex />
      <div className="text-center max-w-md">
        <p className="text-xs uppercase tracking-widest text-primary font-semibold mb-3">Error 404</p>
        <h1 className="mb-4 text-5xl font-black tracking-tight text-foreground">Page not found</h1>
        <p className="mb-6 text-base text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <a
          href="/"
          className="inline-flex items-center justify-center rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-primary hover:bg-primary/90 transition-colors"
        >
          Return to Home
        </a>
      </div>
    </div>
  );
};

export default NotFound;
