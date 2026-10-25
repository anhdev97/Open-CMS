'use client';

import { createContext } from 'react';
import type { Locale } from '@opencloudcms/schema';

export const LocaleContext = createContext<Locale>('en-US');
