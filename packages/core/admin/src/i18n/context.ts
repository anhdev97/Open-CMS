'use client';

import { createContext } from 'react';
import type { Locale } from '@opencms/schema';

export const LocaleContext = createContext<Locale>('en-US');
