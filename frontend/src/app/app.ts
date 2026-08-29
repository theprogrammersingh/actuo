import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
} from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { CopilotPanel } from './copilot/copilot-panel.js';
import { Session } from './core/session/session.js';
import { ThemeService } from './core/theme/theme-service.js';
import { PwaService } from './core/pwa/pwa-service.js';
import { SeoService } from './core/seo/seo-service.js';
import { ToolCallAudit } from './webmcp/tool-call-audit.js';
import { ToolRegistry } from './webmcp/tool-registry.js';
import { ToolSession } from './webmcp/tool-session.js';

interface NavItem {
  path: string;
  label: string;
  icon: string;
}

const NAV: NavItem[] = [
  { path: '/dashboard', label: 'Dashboard', icon: '◫' },
  { path: '/expenses', label: 'Expenses', icon: '≡' },
  { path: '/add', label: 'Add', icon: '＋' },
  { path: '/budgets', label: 'Budgets', icon: '◑' },
  { path: '/agent', label: 'Agent', icon: '✦' },
  { path: '/settings', label: 'Settings', icon: '⚙' },
];

/**
 * App shell.
 *
 * Design Doc §3.1 is mobile-first: a bottom tab bar on a phone, becoming a left
 * rail from `sm:` up. The Copilot orb sits above the tab bar so it never covers
 * a tab target.
 *
 * The shell is also where the WebMCP session is driven — publishing tools once
 * signed in, keeping the state-gated `approve_expense` in step with the user's
 * role and pending queue, and retiring everything on sign-out.
 */
@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, CopilotPanel],
  template: `
    @if (session.isAuthenticated()) {
      <div class="min-h-dvh bg-canvas text-body">
        <!-- Left rail from sm: up (§3.1 progressive enhancement). -->
        <nav
          class="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-line bg-surface p-4 sm:flex"
          aria-label="Main"
        >
          <div class="mb-6 flex items-center gap-2">
            <span class="bg-brand-teal size-7 rounded-lg" aria-hidden="true"></span>
            <span class="font-display text-lg">Actuo</span>
          </div>

          @for (item of nav; track item.path) {
            <a
              [routerLink]="item.path"
              routerLinkActive="bg-card text-body"
              class="mb-1 flex min-h-11 items-center gap-3 rounded-md px-3 text-muted hover:text-body"
            >
              <span aria-hidden="true">{{ item.icon }}</span>
              <span>{{ item.label }}</span>
            </a>
          }

          <div class="mt-auto space-y-1">
            <button
              type="button"
              class="flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-muted hover:text-body"
              (click)="theme.toggle()"
            >
              <span aria-hidden="true">{{ theme.isDark() ? '☾' : '☀' }}</span>
              <span>{{ theme.isDark() ? 'Dark' : 'Light' }} theme</span>
            </button>
            <button
              type="button"
              class="flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-muted hover:text-body"
              (click)="signOut()"
            >
              <span aria-hidden="true">⏻</span>
              <span>Sign out</span>
            </button>
          </div>
        </nav>

        <!--
          PRD §8.4. Both are stated requirements and both are announced, because
          losing your connection mid-approval is exactly the moment a silent
          colour change is not enough.
        -->
        @if (pwa.isOffline()) {
          <!--
            Toned text on a surface, not a filled bar: status.warning is
            #fbbf24 in dark and #b45309 in light, so a fill that reads well in
            one theme fails contrast in the other. The border/text pattern is
            the same one the over-budget banner uses.
          -->
          <div
            class="sticky top-0 z-40 border-b border-status-warning/40 bg-surface px-4 py-2
                   text-center text-sm font-medium text-status-warning sm:ml-56"
            role="status"
          >
            You’re offline. Actuo is showing what it already loaded — nothing will save
            until you’re back.
          </div>
        } @else if (pwa.canInstall()) {
          <div
            class="flex items-center gap-3 border-b border-line bg-surface px-4 py-2 text-sm
                   sm:ml-56"
            role="status"
          >
            <span class="flex-1 text-muted">Install Actuo for a full-screen app on this device.</span>
            <button
              type="button"
              class="min-h-9 rounded-md bg-brand-teal px-3 text-sm font-medium text-ink-inverted"
              (click)="install()"
            >
              Install
            </button>
            <button
              type="button"
              class="min-h-9 px-2 text-muted hover:text-body"
              aria-label="Dismiss the install prompt"
              (click)="pwa.dismiss()"
            >
              ✕
            </button>
          </div>
        }

        <!-- pb-24 keeps content clear of the mobile tab bar and the safe area. -->
        <main class="pb-24 sm:ml-56 sm:pb-8">
          <router-outlet />
        </main>

        <!-- Bottom tab bar on phones. -->
        <nav
          class="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] sm:hidden"
          aria-label="Main"
        >
          @for (item of nav; track item.path) {
            <a
              [routerLink]="item.path"
              routerLinkActive="text-body"
              class="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-muted"
            >
              <span aria-hidden="true">{{ item.icon }}</span>
              <span class="text-[0.65rem]">{{ item.label }}</span>
            </a>
          }
        </nav>

        <app-copilot-panel />
      </div>
    } @else {
      <div class="min-h-dvh bg-canvas text-body">
        <router-outlet />
      </div>
    }
  `,
})
export class App {
  protected readonly session = inject(Session);
  protected readonly theme = inject(ThemeService);
  protected readonly pwa = inject(PwaService);
  private readonly tools = inject(ToolSession);
  private readonly registry = inject(ToolRegistry);
  private readonly audit = inject(ToolCallAudit);
  private readonly destroyRef = inject(DestroyRef);
  private readonly seo = inject(SeoService);

  protected readonly nav = NAV;

  constructor() {
    /*
     * Keep the `robots` meta tag in step with the route. It lives here because
     * the tag is document-global: a component that sets it on load leaves it
     * behind, which is how an authenticated view ended up advertising itself as
     * indexable (PRD §8.5).
     */
    this.seo.start();

    // Publish tools once there is a session, and retire them on sign-out.
    effect(() => {
      if (this.session.isAuthenticated()) void this.tools.start();
      else this.tools.stop();
    });

    /*
     * Ask the server how many expenses are waiting on a decision, as soon as
     * there is a session to ask with.
     *
     * Without this the count sits at 0 forever, `ToolSession`'s gate never
     * opens, and `approve_expense` never registers — the state-gated tool
     * (PRD §7) existed, was tested, and did nothing in the running app.
     */
    effect(() => {
      if (this.session.isAuthenticated()) void this.session.refreshPendingApprovals();
    });

    /*
     * Keep the state-gated `approve_expense` in step with reality. Every change
     * here fires `toolchange`, which is exactly what an observing agent watches
     * — and what makes the tool visibly appear and disappear in the demo.
     */
    effect(() => {
      this.tools.setRole(this.session.role());
      this.tools.setPendingApprovals(this.session.pendingApprovals());
    });

    /*
     * Everything that hangs off a tool call, in one place.
     *
     * The shell is where this belongs: `ToolRegistry` stays a pure registry
     * with no HTTP or session dependencies, and there is exactly one
     * subscription rather than one per consumer.
     */
    const stop = this.registry.observe((invocation) => {
      this.audit.record({
        // Everything reaching the registry is agent-initiated — the in-page
        // Copilot, or an external browser agent through WebMCP's `execute`.
        // The one human tool caller is the declarative Add Expense form, which
        // logs itself because only it can tell the two apart.
        actor: 'agent',
        toolName: invocation.toolName,
        input: invocation.input,
        output: invocation.error ? { error: invocation.error } : invocation.output,
      });

      // An approval decision changes the queue, which closes the gate. Reads
      // cannot, and `search_expenses` runs often enough that polling on it
      // would be a request per question.
      if (this.registry.isMutating(invocation.toolName)) {
        void this.session.refreshPendingApprovals();
      }
    });
    this.destroyRef.onDestroy(stop);
  }

  protected async install(): Promise<void> {
    await this.pwa.install();
  }

  protected async signOut(): Promise<void> {
    await this.session.logout();
  }
}
