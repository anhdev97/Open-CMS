import { logoColor, logoDark } from '../brand';

/** Approved wordmark, with a white wordmark on dark backgrounds. */
export function BrandLogo({ className = '' }: { className?: string }) {
  return (
    <span className={`block ${className}`}>
      <img src={logoColor} alt="OpenCloudCMS" width={1703} height={332} className="block h-auto w-full dark:hidden" />
      <img src={logoDark} alt="OpenCloudCMS" width={1703} height={332} className="hidden h-auto w-full dark:block" />
    </span>
  );
}
