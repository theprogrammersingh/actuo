import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Meta } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { INDEXABLE, NOT_INDEXABLE, SeoService } from './seo-service.js';

@Component({ template: '' })
class Blank {}

function robots(): string | null {
  return TestBed.inject(Meta).getTag('name="robots"')?.getAttribute('content') ?? null;
}

async function setup(): Promise<{ router: Router; seo: SeoService }> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: '', component: Blank, data: { robots: INDEXABLE } },
        { path: 'dashboard', component: Blank, data: { robots: NOT_INDEXABLE } },
        // Deliberately undeclared, to pin the default.
        { path: 'mystery', component: Blank },
      ]),
    ],
  });
  const seo = TestBed.inject(SeoService);
  const router = TestBed.inject(Router);
  seo.start();
  return { router, seo };
}

describe('SeoService', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    // Meta persists across navigations by design; clear it between tests.
    document.querySelectorAll('meta[name="robots"]').forEach((tag) => tag.remove());
  });

  it('marks the landing route indexable', async () => {
    const { router } = await setup();
    await router.navigateByUrl('/');
    expect(robots()).toBe(INDEXABLE);
  });

  /**
   * The bug. `landing.ts` set `index, follow` in its constructor, and a meta tag
   * is document-global — so it survived the navigation and an authenticated
   * view advertised itself as indexable.
   */
  it('flips to noindex when navigating from the landing page into the app', async () => {
    const { router } = await setup();
    await router.navigateByUrl('/');
    expect(robots()).toBe(INDEXABLE);

    await router.navigateByUrl('/dashboard');
    expect(robots()).toBe(NOT_INDEXABLE);
  });

  it('flips back on the way out', async () => {
    const { router } = await setup();
    await router.navigateByUrl('/dashboard');
    await router.navigateByUrl('/');
    expect(robots()).toBe(INDEXABLE);
  });

  /**
   * The safe direction to be wrong in: a missed index costs a page not being
   * found, the reverse leaks an authenticated surface.
   */
  it('treats a route that declares nothing as not indexable', async () => {
    const { router } = await setup();
    await router.navigateByUrl('/mystery');
    expect(robots()).toBe(NOT_INDEXABLE);
  });

  it('is safe to start twice', async () => {
    const { router, seo } = await setup();
    seo.start();
    await router.navigateByUrl('/');

    expect(document.querySelectorAll('meta[name="robots"]')).toHaveLength(1);
    expect(robots()).toBe(INDEXABLE);
  });
});
