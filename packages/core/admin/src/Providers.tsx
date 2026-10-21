'use client';

import { useEffect, type ReactNode } from 'react';
import { Toaster } from './components/ui/sonner';
import { TooltipProvider } from './components/ui/tooltip';
import { I18nProvider } from './i18n/I18nProvider';
import { applyTheme, watchSystemTheme } from './lib/theme';

export default function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    applyTheme();
    return watchSystemTheme();
  }, []);
  return (
    <I18nProvider>
      <TooltipProvider>
        {children}
        <Toaster />
      </TooltipProvider>
    </I18nProvider>
  );
}
