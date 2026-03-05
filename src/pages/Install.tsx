import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Download, Share, MoreVertical, Plus, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import SEOHead from '@/components/SEOHead';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const Install = () => {
  const navigate = useNavigate();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);

    if (window.matchMedia("(display-mode: standalone)").matches) {
      setIsInstalled(true);
    }

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") setIsInstalled(true);
    setDeferredPrompt(null);
  };

  return (
    <div className="min-h-screen bg-background p-4 max-w-lg mx-auto">
      <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-muted-foreground mb-6 text-sm">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <div className="text-center mb-8">
        <img src="/pwa-icon-192.png" alt="HaulTrackerPro" className="w-20 h-20 mx-auto rounded-2xl shadow-lg mb-4" />
        <h1 className="text-2xl font-bold text-foreground">Install HaulTrackerPro</h1>
        <p className="text-muted-foreground mt-2">Add to your home screen for quick access — works offline like a native app.</p>
      </div>

      {isInstalled ? (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="pt-6 text-center">
            <p className="text-primary font-semibold">✅ App is already installed!</p>
            <p className="text-sm text-muted-foreground mt-1">Open it from your home screen.</p>
          </CardContent>
        </Card>
      ) : deferredPrompt ? (
        <Button onClick={handleInstall} className="w-full h-12 text-base gap-2" size="lg">
          <Download className="w-5 h-5" /> Install App
        </Button>
      ) : (
        <div className="space-y-6">
          <Card>
            <CardContent className="pt-6">
              <h2 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                <Share className="w-4 h-4" /> iPhone / Safari
              </h2>
              <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
                <li>Tap the <strong>Share</strong> button at the bottom of Safari</li>
                <li>Scroll down and tap <strong>"Add to Home Screen"</strong></li>
                <li>Tap <strong>"Add"</strong> in the top right</li>
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <h2 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                <MoreVertical className="w-4 h-4" /> Android / Chrome
              </h2>
              <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
                <li>Tap the <strong>⋮ menu</strong> in the top right of Chrome</li>
                <li>Tap <strong>"Add to Home screen"</strong> or <strong>"Install app"</strong></li>
                <li>Tap <strong>"Install"</strong></li>
              </ol>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default Install;
