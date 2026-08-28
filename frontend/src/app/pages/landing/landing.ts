import { DOCUMENT, ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';

/**
 * The public landing page — the only route deliberately built for crawlers.
 *
 * PRD §8.5: this is server-rendered so search engines and AI agents get real
 * content on first load, carries schema.org structured data and Open Graph
 * tags, and is the only page in the sitemap. Every authenticated view is
 * `noindex` instead, because indexing gated data is pointless.
 */
@Component({
  selector: 'app-landing',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <div class="min-h-dvh bg-canvas text-body">
      <header class="mx-auto flex max-w-5xl items-center gap-3 px-5 py-5">
        <span class="bg-aurora size-8 rounded-lg" aria-hidden="true"></span>
        <span class="font-display text-xl">Actuo</span>
        <nav class="ml-auto flex items-center gap-2" aria-label="Account">
          <a routerLink="/login" class="flex min-h-11 items-center px-3 text-muted hover:text-body">
            Sign in
          </a>
          <a
            routerLink="/signup"
            class="flex min-h-11 items-center rounded-md bg-brand-teal px-4 font-medium text-ink-inverted"
          >
            Get started
          </a>
        </nav>
      </header>

      <main class="mx-auto max-w-5xl px-5">
        <section class="py-14 sm:py-20">
          <h1 class="font-display text-4xl leading-tight sm:text-5xl">
            Expense management an
            <span class="text-aurora">AI agent</span>
            can actually operate.
          </h1>
          <p class="mt-5 max-w-2xl text-lg text-muted">
            Actuo is a full expense platform where every meaningful action is also a
            <abbr title="Web Model Context Protocol">WebMCP</abbr> tool. Agents don't click
            around your UI hoping for the best — they call typed, permissioned tools, and you
            see every one of them as it happens.
          </p>
          <div class="mt-8 flex flex-wrap gap-3">
            <a
              routerLink="/signup"
              class="flex min-h-12 items-center rounded-md bg-brand-teal px-5 font-medium text-ink-inverted"
            >
              Create an account
            </a>
            <a
              routerLink="/login"
              class="flex min-h-12 items-center rounded-md border border-line px-5 font-medium"
            >
              Try the demo account
            </a>
          </div>
        </section>

        <section class="grid gap-4 pb-16 sm:grid-cols-3" aria-label="How it works">
          @for (feature of features; track feature.title) {
            <article class="rounded-xl border border-line bg-card p-5">
              <h2 class="mb-2 font-display text-lg">{{ feature.title }}</h2>
              <p class="text-sm text-muted">{{ feature.body }}</p>
            </article>
          }
        </section>

        <section class="pb-20">
          <h2 class="mb-3 font-display text-2xl">Your key, your browser</h2>
          <p class="max-w-2xl text-muted">
            Actuo never holds an LLM key. You bring your own Google Gemini key, it is stored
            only in your browser, and every model call goes straight from your browser to
            Google. You can confirm that yourself in the network tab — it never touches
            Actuo's servers.
          </p>
        </section>
      </main>

      <footer class="border-t border-line">
        <div class="mx-auto max-w-5xl px-5 py-6 text-sm text-muted">
          Actuo — a reference implementation of the WebMCP standard.
        </div>
      </footer>
    </div>
  `,
})
export class Landing {
  private readonly meta = inject(Meta);
  private readonly title = inject(Title);
  private readonly document = inject(DOCUMENT);

  protected readonly features = [
    {
      title: 'Tools, not clicks',
      body: 'Search, submit, budget checks and report generation are declared tools with strict JSON Schemas — so an agent acts precisely instead of guessing at the DOM.',
    },
    {
      title: 'Every action visible',
      body: 'Each tool call renders as a card showing what ran, what it changed, and its raw input and result. Anything that moves money asks first.',
    },
    {
      title: 'Permissions still apply',
      body: 'An agent can do exactly what you can do and nothing more. Roles are enforced on the server, so a tool call is checked the same way a click is.',
    },
  ];

  constructor() {
    const description =
      "Actuo is an AI-native expense management platform. Every action is a WebMCP tool, so agents can operate it transparently — with your own Gemini key, kept in your browser.";

    this.title.setTitle('Actuo — AI-native expense intelligence with a WebMCP Copilot');
    this.meta.updateTag({ name: 'description', content: description });
    this.meta.updateTag({ property: 'og:title', content: 'Actuo — AI-native expense intelligence' });
    this.meta.updateTag({ property: 'og:description', content: description });
    this.meta.updateTag({ property: 'og:type', content: 'website' });
    this.meta.updateTag({ name: 'twitter:card', content: 'summary_large_image' });
    // The public page is the only indexable surface (PRD §8.5).
    this.meta.updateTag({ name: 'robots', content: 'index, follow' });

    this.addStructuredData();
  }

  /**
   * schema.org SoftwareApplication. Written into the DOM rather than the
   * template so it is a real `application/ld+json` script that survives SSR;
   * Angular would otherwise treat the JSON as text to interpolate.
   */
  private addStructuredData(): void {
    const id = 'actuo-structured-data';
    if (this.document.getElementById(id)) return;

    const script = this.document.createElement('script');
    script.id = id;
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Actuo',
      applicationCategory: 'FinanceApplication',
      operatingSystem: 'Web',
      description:
        'AI-native expense management platform with a universal WebMCP Copilot. Bring your own Gemini key.',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    });
    this.document.head.appendChild(script);
  }
}
