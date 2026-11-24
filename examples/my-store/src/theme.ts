// Brand colors and palettes. Managed by OpenCloudCMS: edit by hand or from the admin
// Page builder > Theme (which rewrites this file).
import { defineTheme } from '@opencloudcms/schema';

export default defineTheme({
  colors: {
    surface: { label: 'Surface' },
    feature: { label: 'Feature band' },
    ink: { label: 'Ink' },
    accent: { label: 'Accent' },
    'accent-ink': { label: 'Text on accent' },
    line: { label: 'Line' },
  },
  palettes: {
    olive: { label: 'Cream and olive', values: { surface: '#fbf8ef', feature: '#ece9d7', ink: '#28291e', accent: '#3d462c', 'accent-ink': '#fffdf4', line: '#cfcab9' } },
    clay: { label: 'Cream and clay', values: { surface: '#fcf5ef', feature: '#f4e3db', ink: '#39251e', accent: '#8b432f', 'accent-ink': '#fff8f2', line: '#e3c4b7' } },
    night: { label: 'White and forest green', values: { surface: '#f3f5f3', feature: '#e3eae5', ink: '#19322b', accent: '#20483c', 'accent-ink': '#f8fbf8', line: '#bfcfc6' } },
  },
  activePalette: 'olive',
});
