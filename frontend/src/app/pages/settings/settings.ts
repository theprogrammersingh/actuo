import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type {
  AuditLogEntry,
  Category,
  Organization,
  Page,
  Role,
  ToolCallLogEntry,
} from '@actuo/shared';
import { Badge, Card, EmptyState, ErrorState, Skeleton } from '../../ui';
import { ApiClient, ApiError } from '../../core/api/api-client.js';
import { Session } from '../../core/session/session.js';
import { AiSettings } from './ai-settings.js';

/** Audit-log filter. `all` sends no `actor` param at all. */
export type ActorFilter = 'all' | 'human' | 'agent';

const ACTOR_FILTERS: ReadonlyArray<{ value: ActorFilter; label: string }> = [
  { value: 'all', label: 'Everything' },
  { value: 'human', label: 'Human' },
  { value: 'agent', label: 'Agent' },
];

const ROLE_COPY: Record<Role, string> = {
  owner: 'You own this organization — you can change anything here.',
  admin: 'You administer this organization and can approve expenses.',
  member: 'You can submit expenses. Org settings are managed by an owner or admin.',
};

/**
 * Settings / Admin (Design Doc §3.3, PRD §6.9).
 *
 * Four sections, in the order someone actually needs them: what this
 * organization is, how its spend is categorized, the BYOK section that makes
 * the Copilot work, and the audit log that shows what has been done.
 *
 * The audit log's human/agent filter is not incidental. `tool_call_log` records
 * every WebMCP invocation with the actor that made it, so flipping to "Agent"
 * answers "what exactly did the AI do in my org" with rows rather than
 * reassurance — which is the whole demo narrative (PRD §8.7).
 *
 * Each section loads independently: a failing audit query must not take the
 * BYOK panel down with it, since that panel is the one a stuck judge needs.
 */
@Component({
  selector: 'app-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AiSettings, Badge, Card, EmptyState, ErrorState, Skeleton],
  host: { class: 'block' },
  template: `
    <div class="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <header>
        <h1 class="font-display text-2xl font-semibold text-body">Settings</h1>
        <p class="mt-1.5 text-sm text-muted">
          Your organization, its categories, the Copilot's key, and a record of everything that
          has been done here.
        </p>
      </header>

      <!-- Organization ---------------------------------------------------- -->
      <ui-card padding="lg">
        <header uiCardHeader class="mb-4">
          <h2 class="font-display text-lg font-semibold text-body">Organization</h2>
        </header>

        @if (orgLoading()) {
          <ui-skeleton shape="text" [lines]="2" label="Loading organization" />
        } @else if (orgError(); as message) {
          <ui-error-state
            heading="Organization details didn't load"
            [message]="message"
            (retry)="loadOrg()"
          />
        } @else if (org(); as organization) {
          <dl class="grid gap-4 sm:grid-cols-2">
            <div>
              <dt class="text-xs font-medium tracking-wide text-muted uppercase">Name</dt>
              <dd class="mt-1 text-sm text-body">{{ organization.name }}</dd>
            </div>
            <div>
              <dt class="text-xs font-medium tracking-wide text-muted uppercase">Base currency</dt>
              <dd class="mt-1 font-mono text-sm text-body">{{ organization.baseCurrency }}</dd>
            </div>
          </dl>

          @if (roleCopy(); as copy) {
            <p class="mt-4 flex items-center gap-2 text-sm text-muted">
              <ui-badge tone="info" [label]="roleLabel()" />
              <span>{{ copy }}</span>
            </p>
          }
        }
      </ui-card>

      <!-- Categories ------------------------------------------------------ -->
      <ui-card padding="lg">
        <header uiCardHeader class="mb-4">
          <h2 class="font-display text-lg font-semibold text-body">Categories</h2>
          <p class="mt-1 text-sm text-muted">
            What expenses can be filed under. Budgets and the Copilot both use these names.
          </p>
        </header>

        @if (categoriesLoading()) {
          <ui-skeleton shape="text" [lines]="2" label="Loading categories" />
        } @else if (categoriesError(); as message) {
          <ui-error-state
            heading="Categories didn't load"
            [message]="message"
            (retry)="loadCategories()"
          />
        } @else if (categories().length === 0) {
          <ui-empty-state
            heading="No categories yet"
            message="Add one to start grouping spend — 'Travel' and 'Software' are common first picks."
            [headingLevel]="3"
          />
        } @else {
          <ul class="flex flex-wrap gap-2">
            @for (category of categories(); track category.id) {
              <li
                class="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface
                       px-3 py-1.5 text-sm text-body"
              >
                @if (category.icon) {
                  <span aria-hidden="true">{{ category.icon }}</span>
                }
                <span>{{ category.name }}</span>
                @if (category.isDefault) {
                  <span class="text-xs text-muted">default</span>
                }
              </li>
            }
          </ul>
        }
      </ui-card>

      <!-- AI & Copilot (BYOK) --------------------------------------------- -->
      <app-ai-settings />

      <!-- Audit log ------------------------------------------------------- -->
      <ui-card padding="lg">
        <header uiCardHeader class="mb-4">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 class="font-display text-lg font-semibold text-body">Tool calls</h2>
              <p class="mt-1 text-sm text-muted">
                Every WebMCP tool invocation, whether a person triggered it or the Copilot did.
              </p>
            </div>

            <div
              class="inline-flex rounded-lg border border-line p-0.5"
              role="group"
              aria-label="Filter the audit log by actor"
            >
              @for (option of actorFilters; track option.value) {
                <button
                  type="button"
                  class="min-h-9 rounded-md px-3 text-xs font-medium transition-colors duration-150
                         ease-out focus-visible:outline-2 focus-visible:-outline-offset-2
                         focus-visible:outline-brand-teal"
                  [class.bg-card]="actor() === option.value"
                  [class.text-body]="actor() === option.value"
                  [class.text-muted]="actor() !== option.value"
                  [attr.aria-pressed]="actor() === option.value"
                  (click)="setActor(option.value)"
                >
                  {{ option.label }}
                </button>
              }
            </div>
          </div>
        </header>

        @if (logLoading()) {
          <ui-skeleton shape="list" [lines]="4" label="Loading the audit log" />
        } @else if (logError(); as message) {
          <ui-error-state heading="The audit log didn't load" [message]="message" (retry)="loadLog()" />
        } @else if (entries().length === 0) {
          <ui-empty-state
            heading="Nothing logged yet"
            [message]="emptyLogMessage()"
            [headingLevel]="3"
          />
        } @else {
          <ul class="divide-y divide-line">
            @for (entry of entries(); track entry.id) {
              <li class="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-3">
                <ui-badge
                  [tone]="entry.actor === 'agent' ? 'info' : 'neutral'"
                  [label]="entry.actor === 'agent' ? 'Agent' : 'Human'"
                />
                <span class="font-mono text-sm text-body">{{ entry.toolName }}</span>
                <span class="ml-auto text-xs text-muted tabular">{{
                  formatTime(entry.createdAt)
                }}</span>
                <p class="w-full truncate font-mono text-xs text-muted">
                  {{ preview(entry.input) }}
                </p>
              </li>
            }
          </ul>

          @if (total() > entries().length) {
            <p class="mt-4 text-xs text-muted">
              Showing the {{ entries().length }} most recent of {{ total() }}.
            </p>
          }
        }
      </ui-card>

      <!-- Change history --------------------------------------------------- -->
      @if (mayAudit()) {
        <ui-card padding="lg">
          <header uiCardHeader class="mb-4">
            <h2 class="font-display text-lg font-semibold text-body">Change history</h2>
            <p class="mt-1 text-sm text-muted">
              What actually changed, and who changed it. The panel above records tool
              <em>calls</em>; this one records the <em>state changes</em> they and every
              button in the app produced — approving an expense appears here, a Copilot
              search does not.
            </p>
          </header>

          @if (auditLoading()) {
            <ui-skeleton shape="list" [lines]="4" label="Loading the change history" />
          } @else if (auditError(); as message) {
            <ui-error-state
              heading="The change history didn’t load"
              [message]="message"
              (retry)="loadAudit()"
            />
          } @else if (auditEntries().length === 0) {
            <ui-empty-state
              heading="Nothing has changed yet"
              message="File or approve an expense and the record of it shows up here."
              [headingLevel]="3"
            />
          } @else {
            <ul class="divide-y divide-line">
              @for (entry of auditEntries(); track entry.id) {
                <li class="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-3">
                  <ui-badge tone="neutral" [label]="entry.entity" />
                  <span class="font-mono text-sm text-body">{{ entry.action }}</span>
                  <span class="tabular ml-auto text-xs text-muted">{{
                    formatTime(entry.createdAt)
                  }}</span>
                  <p class="w-full truncate font-mono text-xs text-muted">
                    {{ preview(entry.metadata) }}
                  </p>
                </li>
              }
            </ul>

            @if (auditTotal() > auditEntries().length) {
              <p class="mt-4 text-xs text-muted">
                Showing the {{ auditEntries().length }} most recent of {{ auditTotal() }}.
              </p>
            }
          }
        </ui-card>
      }
    </div>
  `,
})
export class Settings {
  private readonly api = inject(ApiClient);
  readonly session = inject(Session);

  protected readonly actorFilters = ACTOR_FILTERS;

  protected readonly org = signal<Organization | null>(null);
  protected readonly orgLoading = signal(false);
  protected readonly orgError = signal<string | null>(null);

  protected readonly categories = signal<readonly Category[]>([]);
  protected readonly categoriesLoading = signal(false);
  protected readonly categoriesError = signal<string | null>(null);

  /**
   * `GET /api/audit-log` is owner/admin only — it spans other people's actions
   * across the whole org, which is a wider disclosure than the tool-call log.
   * Hiding the panel matches the route; the route is what enforces it.
   */
  protected readonly mayAudit = computed(() => {
    const role = this.session.role();
    return role === 'owner' || role === 'admin';
  });

  protected readonly auditEntries = signal<readonly AuditLogEntry[]>([]);
  protected readonly auditTotal = signal(0);
  protected readonly auditLoading = signal(false);
  protected readonly auditError = signal<string | null>(null);

  protected readonly actor = signal<ActorFilter>('all');
  protected readonly entries = signal<readonly ToolCallLogEntry[]>([]);
  protected readonly total = signal(0);
  protected readonly logLoading = signal(false);
  protected readonly logError = signal<string | null>(null);

  protected readonly roleCopy = computed(() => {
    const role = this.session.role();
    return role ? ROLE_COPY[role] : null;
  });

  protected readonly roleLabel = computed(() => {
    const role = this.session.role();
    return role ? role.charAt(0).toUpperCase() + role.slice(1) : '';
  });

  protected readonly emptyLogMessage = computed(() => {
    switch (this.actor()) {
      case 'agent':
        return 'The Copilot has not run a tool yet. Ask it to find or file an expense and this fills up.';
      case 'human':
        return 'No tool has been run from the UI yet. Submitting or approving an expense logs a row here.';
      default:
        return 'Nothing has been done in this organization yet. Actions taken from the UI and by the Copilot both land here.';
    }
  });

  constructor() {
    // `ApiClient` refuses to run during SSR, so loading is a browser-only
    // concern. Settings is behind auth and deliberately `noindex` anyway.
    if (this.session.isBrowser) {
      void this.loadOrg();
      void this.loadCategories();
      void this.loadLog();
      if (this.mayAudit()) void this.loadAudit();
    }
  }

  protected async loadOrg(): Promise<void> {
    this.orgLoading.set(true);
    this.orgError.set(null);
    try {
      this.org.set(await this.api.get<Organization>('/orgs/current'));
    } catch (error) {
      this.orgError.set(describeFailure(error));
    } finally {
      this.orgLoading.set(false);
    }
  }

  protected async loadCategories(): Promise<void> {
    this.categoriesLoading.set(true);
    this.categoriesError.set(null);
    try {
      this.categories.set(await this.api.get<Category[]>('/orgs/current/categories'));
    } catch (error) {
      this.categoriesError.set(describeFailure(error));
    } finally {
      this.categoriesLoading.set(false);
    }
  }

  protected setActor(next: ActorFilter): void {
    if (this.actor() === next) return;
    this.actor.set(next);
    void this.loadLog();
  }

  protected async loadLog(): Promise<void> {
    this.logLoading.set(true);
    this.logError.set(null);
    const actor = this.actor();
    try {
      const page = await this.api.get<Page<ToolCallLogEntry>>('/tool-calls', {
        // `all` must send nothing: the endpoint validates `actor` against
        // human|agent and would 400 on the literal string "all".
        actor: actor === 'all' ? undefined : actor,
        limit: 25,
      });
      this.entries.set(page.items);
      this.total.set(page.total);
    } catch (error) {
      this.logError.set(describeFailure(error));
    } finally {
      this.logLoading.set(false);
    }
  }

  protected async loadAudit(): Promise<void> {
    this.auditLoading.set(true);
    this.auditError.set(null);
    try {
      const page = await this.api.get<Page<AuditLogEntry>>('/audit-log', { limit: 25 });
      this.auditEntries.set(page.items);
      this.auditTotal.set(page.total);
    } catch (error) {
      this.auditError.set(describeFailure(error));
    } finally {
      this.auditLoading.set(false);
    }
  }

  /** Short, local, and stable — the log is scanned, not read line by line. */
  protected formatTime(iso: string): string {
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return iso;
    return parsed.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  /** One line of the arguments a tool was called with. */
  protected preview(input: unknown): string {
    if (input === null || input === undefined) return '—';
    let text: string;
    try {
      text = typeof input === 'string' ? input : JSON.stringify(input);
    } catch {
      return '—';
    }
    if (!text) return '—';
    return text.length > 160 ? `${text.slice(0, 159)}…` : text;
  }
}

/** Actionable, never blaming (Design Doc §3.6). */
function describeFailure(error: unknown): string {
  if (error instanceof ApiError) {
    // `ApiClient` reports both an unreachable server and an SSR call as 0.
    if (error.status === 0) return "Actuo didn't respond. Check your connection and try again.";
    if (error.status === 401 || error.status === 403) {
      return 'This session is not allowed to read that. Signing in again usually fixes it.';
    }
    if (error.status >= 500) {
      return 'Actuo had a problem on its side. Nothing was changed — try again in a moment.';
    }
    if (error.message) return error.message;
  }
  return error instanceof Error && error.message
    ? error.message
    : 'The request came back empty. Try again.';
}
