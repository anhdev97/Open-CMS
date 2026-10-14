import type { Metadata } from 'next';
import { Sidebar } from '@/components/Sidebar';
import './globals.css';

export const metadata: Metadata = {
  title: 'opencms admin',
  description: 'Content Type Builder and content manager for opencms',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <Sidebar />
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
