'use client';

import { useEffect, type ReactNode } from 'react';
import { Toaster } from './components/ui/sonner';
import { TooltipProvider } from './components/ui/tooltip';
import { applyTheme, watchSystemTheme } from './lib/theme';

export default function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    applyTheme();
    return watchSystemTheme();
  }, []);
  return (
    <TooltipProvider>
      {children}
      <Toaster />
    </TooltipProvider>
  );
}
