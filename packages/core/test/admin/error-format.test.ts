import { describe, expect, it } from 'vitest';
import { formatIssue } from '../../admin/src/lib/format-issue';

describe('formatIssue', () => {
  it('prints string issues as-is', () => {
    expect(formatIssue('Title is required')).toBe('Title is required');
  });

  it('formats {path,message} as "path: message"', () => {
    expect(formatIssue({ path: 'title', message: 'Required' })).toBe('title: Required');
  });

  it('includes the locale when present', () => {
    expect(formatIssue({ locale: 'vi', path: 'title', message: 'Required' })).toBe('[vi] title: Required');
  });

  it('prints just the message when there is no path', () => {
    expect(formatIssue({ message: 'Bad input' })).toBe('Bad input');
  });

  it('falls back to JSON for unknown objects', () => {
    expect(formatIssue({ foo: 1 })).toBe('{"foo":1}');
    expect(formatIssue(42)).toBe('42');
  });
});
