import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { CopilotPanel } from './copilot/copilot-panel.js';
import { Session } from './core/session/session.js';
import { ThemeService } from './core/theme/theme-service.js';
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
            <span class="bg-aurora size-7 rounded-lg" aria-hidden="true"></span>
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
  private readonly tools = inject(ToolSession);

  protected readonly nav = NAV;

  constructor() {
    // Publish tools once there is a session, and retire them on sign-out.
    effect(() => {
      if (this.session.isAuthenticated()) void this.tools.start();
      else this.tools.stop();
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
  }

  protected async signOut(): Promise<void> {
    await this.session.logout();
  }
}
