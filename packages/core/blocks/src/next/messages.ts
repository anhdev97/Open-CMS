import type { Locale } from '@opencloudcms/schema';

/** Website-side copy (no admin i18n provider here): preview bar and welcome page, in the 4 supported locales. */
export type SiteMessages = {
  draft: string;
  exit: string;
  expired: string;
  signIn: string;
  welcomeTitle: string;
  welcomeText: string;
  buildFirstPage: string;
  openAdmin: string;
};

export const SITE_MESSAGES: Record<Locale, SiteMessages> = {
  'en-US': {
    draft: 'Viewing draft',
    exit: 'Exit',
    expired: 'Your draft preview session has expired. Sign in again to see drafts.',
    signIn: 'Sign in',
    welcomeTitle: 'Welcome',
    welcomeText: 'A website and its OpenCloudCMS admin, served by one Next.js app. No page is published at / yet.',
    buildFirstPage: 'Build your first page',
    openAdmin: 'Open admin',
  },
  'vi-VN': {
    draft: 'Đang xem bản nháp',
    exit: 'Thoát',
    expired: 'Phiên xem nháp đã hết. Đăng nhập lại để xem bản nháp.',
    signIn: 'Đăng nhập',
    welcomeTitle: 'Chào mừng',
    welcomeText: 'Một website và trang quản trị OpenCloudCMS, chạy trong cùng một ứng dụng Next.js. Chưa có trang nào được publish ở /.',
    buildFirstPage: 'Dựng trang đầu tiên',
    openAdmin: 'Mở trang quản trị',
  },
  'fr-FR': {
    draft: 'Brouillon affiché',
    exit: 'Quitter',
    expired: 'Votre session d’aperçu a expiré. Reconnectez-vous pour voir les brouillons.',
    signIn: 'Se connecter',
    welcomeTitle: 'Bienvenue',
    welcomeText: 'Un site web et son administration OpenCloudCMS, servis par une seule application Next.js. Aucune page n’est encore publiée sur /.',
    buildFirstPage: 'Créer votre première page',
    openAdmin: 'Ouvrir l’administration',
  },
  'id-ID': {
    draft: 'Melihat draf',
    exit: 'Keluar',
    expired: 'Sesi pratinjau draf Anda telah berakhir. Masuk lagi untuk melihat draf.',
    signIn: 'Masuk',
    welcomeTitle: 'Selamat datang',
    welcomeText: 'Sebuah situs web dan admin OpenCloudCMS-nya, dilayani oleh satu aplikasi Next.js. Belum ada halaman yang dipublikasikan di /.',
    buildFirstPage: 'Buat halaman pertama Anda',
    openAdmin: 'Buka admin',
  },
};

export const siteMessages = (locale: Locale): SiteMessages => SITE_MESSAGES[locale] ?? SITE_MESSAGES['en-US'];
