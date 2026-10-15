import { useState } from 'react';
import { DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu';
import { getTheme, setTheme, type Theme } from '@/lib/theme';
import { t } from '@/i18n/en';

const THEMES: Theme[] = ['light', 'dark', 'system'];

/** Light / Dark / System radio items; render inside a `DropdownMenuContent` or `DropdownMenuSubContent`. */
export function ThemeToggle() {
  const [theme, setCurrent] = useState<Theme>(getTheme);
  return (
    <DropdownMenuRadioGroup
      value={theme}
      onValueChange={(v) => {
        setTheme(v as Theme);
        setCurrent(v as Theme);
      }}
    >
      {THEMES.map((name) => (
        <DropdownMenuRadioItem key={name} value={name}>
          {t(`theme.${name}`)}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}
