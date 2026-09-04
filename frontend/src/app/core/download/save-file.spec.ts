import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveBlob } from './save-file';

describe('saveBlob', () => {
  let created: string;
  let revoked: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    created = 'blob:actuo/report';
    revoked = [];
    URL.createObjectURL = vi.fn(() => created);
    URL.revokeObjectURL = vi.fn((url: string) => void revoked.push(url));
  });

  afterEach(() => vi.useRealTimers());

  it('clicks a download anchor for the blob and cleans up after itself', () => {
    const clicks: HTMLAnchorElement[] = [];
    const original = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      clicks.push(this as HTMLAnchorElement);
    };

    try {
      saveBlob(new Blob(['date,merchant'], { type: 'text/csv' }), 'report.csv');
    } finally {
      HTMLAnchorElement.prototype.click = original;
    }

    expect(clicks).toHaveLength(1);
    expect(clicks[0].getAttribute('download')).toBe('report.csv');
    expect(clicks[0].href).toContain(created);
    // The anchor must not outlive the click.
    expect(document.querySelector('a[download]')).toBeNull();
  });

  /** Revoking in the same task can cancel the download the click just began. */
  it('revokes the object URL only on a later task', () => {
    HTMLAnchorElement.prototype.click = vi.fn();

    saveBlob(new Blob(['x']), 'report.csv');
    expect(revoked).toEqual([]);

    vi.runAllTimers();
    expect(revoked).toEqual([created]);
  });
});
