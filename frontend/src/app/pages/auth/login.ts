import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { Button, Card, Input } from '../../ui';
import { Session, SessionError } from '../../core/session/session.js';

/**
 * A seeded account, so a hackathon judge can be inside the app in one click.
 *
 * PRD §11 lists setup friction as a live risk to the demo. Sign-up asks for
 * four fields and a 12-character password; nobody evaluating a submission wants
 * to do that before they can look at anything.
 *
 * These are deliberately visible in the client bundle: they are demo fixtures
 * in a seeded tenant, not secrets. If this app ever runs against real data, the
 * affordance below goes with them.
 */
export interface DemoAccount {
  label: string;
  description: string;
  email: string;
}

export const DEMO_PASSWORD = 'Demo1234!';

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  {
    label: 'Priya — owner',
    description: 'Sees every expense and can approve.',
    email: 'priya@actuo.demo',
  },
  {
    label: 'Arjun — member',
    description: 'Submits expenses, cannot approve.',
    email: 'arjun@actuo.demo',
  },
] as const;

/**
 * Sign-in screen (PRD §6.1).
 *
 * Deliberately does **not** navigate. Routing and guards live with the app
 * shell: this component authenticates, flips `Session.isAuthenticated()`, and
 * emits {@link authenticated}. A guard on the login route sends an
 * already-signed-in visitor onwards, which is also what makes the back button
 * behave.
 *
 * State is held in signals bound through `ui-input`'s `model()` rather than in
 * a `FormGroup`. Under zoneless change detection a signal write is what
 * schedules the re-render, so validation messages update deterministically.
 */
@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Card, Input],
  host: { class: 'block' },
  template: `
    <section class="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-10 sm:py-16">
      <header>
        <h1 class="font-display text-2xl font-semibold text-body">Sign in to Actuo</h1>
        <p class="mt-1.5 text-sm text-muted">
          Expense management that you and your agents can both drive.
        </p>
      </header>

      <ui-card padding="lg">
        <form class="flex flex-col gap-4" novalidate (submit)="onSubmit($event)">
          <ui-input
            label="Work email"
            type="email"
            name="email"
            autocomplete="email"
            placeholder="you@company.com"
            [(value)]="email"
            [error]="emailError()"
            required
          />

          <ui-input
            label="Password"
            type="password"
            name="password"
            autocomplete="current-password"
            [(value)]="password"
            [error]="passwordError()"
            required
          />

          @if (formError(); as message) {
            <p
              class="rounded-lg border border-status-danger/30 bg-status-danger/10 px-3 py-2
                     text-sm text-status-danger"
              role="alert"
            >
              {{ message }}
            </p>
          }

          <button uiButton type="submit" size="lg" block [loading]="busy()" loadingLabel="Signing in">
            Sign in
          </button>
        </form>

        <!--
          The demo affordance. Quiet by default so it reads as a shortcut, not
          as the primary path — but one tap away, because the judge is the
          person most likely to need it.
        -->
        <div uiCardFooter class="mt-6 border-t border-line pt-4">
          <button
            type="button"
            class="rounded text-xs font-medium text-muted underline underline-offset-4
                   transition-colors duration-150 ease-out hover:text-body
                   focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-teal"
            [attr.aria-expanded]="demoOpen()"
            (click)="toggleDemo()"
          >
            Use a demo account
          </button>

          @if (demoOpen()) {
            <p class="mt-3 text-xs text-muted">
              Seeded accounts in the demo organization. Both sign in with the password
              <code class="font-mono text-body">{{ demoPassword }}</code
              >.
            </p>
            <div class="mt-3 flex flex-col gap-2">
              @for (account of demoAccounts; track account.email) {
                <button
                  uiButton
                  variant="secondary"
                  size="md"
                  [disabled]="busy()"
                  (click)="useDemoAccount(account)"
                >
                  <span class="text-left">
                    <span class="block">{{ account.label }}</span>
                    <span class="block text-xs font-normal text-muted">{{
                      account.description
                    }}</span>
                  </span>
                </button>
              }
            </div>
          }
        </div>
      </ui-card>

      <p class="text-center text-sm text-muted">
        No account yet?
        <button
          type="button"
          class="rounded font-medium text-brand-teal underline underline-offset-4
                 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-teal"
          (click)="wantsSignup.emit()"
        >
          Create an organization
        </button>
      </p>
    </section>
  `,
})
export class Login {
  private readonly session = inject(Session);

  /** Fires once the session is live. The shell decides where to go next. */
  readonly authenticated = output<void>();
  /** The "create an organization" link, so the shell owns the route name. */
  readonly wantsSignup = output<void>();

  protected readonly demoAccounts = DEMO_ACCOUNTS;
  protected readonly demoPassword = DEMO_PASSWORD;

  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly demoOpen = signal(false);
  protected readonly submitted = signal(false);
  protected readonly formError = signal<string | null>(null);

  protected readonly busy = this.session.busy;

  /**
   * Field errors appear only after a submit attempt. Marking a field invalid
   * while someone is still typing their address is noise, not help.
   */
  protected readonly emailError = computed(() => {
    if (!this.submitted()) return null;
    const value = this.email().trim();
    if (!value) return 'Enter the email address you signed up with.';
    if (!value.includes('@')) return 'That does not look like an email address.';
    return null;
  });

  protected readonly passwordError = computed(() =>
    this.submitted() && !this.password() ? 'Enter your password.' : null,
  );

  protected toggleDemo(): void {
    this.demoOpen.update((open) => !open);
  }

  /** Fills the form visibly, then signs in — no hidden credentials. */
  protected useDemoAccount(account: DemoAccount): void {
    this.email.set(account.email);
    this.password.set(DEMO_PASSWORD);
    void this.signIn();
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    void this.signIn();
  }

  private async signIn(): Promise<void> {
    this.submitted.set(true);
    this.formError.set(null);
    if (this.emailError() || this.passwordError()) return;

    try {
      await this.session.login(this.email().trim(), this.password());
      this.password.set('');
      this.authenticated.emit();
    } catch (error) {
      this.formError.set(
        error instanceof SessionError
          ? error.message
          : 'Sign-in did not complete. Try again in a moment.',
      );
    }
  }
}
