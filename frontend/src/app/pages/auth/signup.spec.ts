import { PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { AuthSession } from '@actuo/shared';

import { ApiClient, ApiError } from '../../core/api/api-client.js';
import { Session } from '../../core/session/session.js';
import { MIN_PASSWORD_LENGTH, Signup } from './signup.js';

const SESSION: AuthSession = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  user: {
    id: 'user-2',
    email: 'sam@northwind.test',
    name: 'Sam',
    createdAt: '2026-01-04T09:00:00.000Z',
  },
  orgId: 'org-2',
  role: 'owner',
};

class FakeApi {
  readonly posts: Array<{ path: string; body: unknown }> = [];
  reply: () => unknown = () => SESSION;

  setAccessToken(): void {}
  get(): Promise<never> {
    throw new ApiError('unexpected GET', 404, null);
  }
  async post<T>(path: string, body?: unknown): Promise<T> {
    this.posts.push({ path, body });
    return this.reply() as T;
  }
  patch(): Promise<never> {
    throw new ApiError('unexpected PATCH', 404, null);
  }
  delete(): Promise<never> {
    throw new ApiError('unexpected DELETE', 404, null);
  }
}

describe('Signup', () => {
  let fixture: ComponentFixture<Signup>;
  let api: FakeApi;

  const host = () => fixture.nativeElement as HTMLElement;
  const text = () => host().textContent ?? '';
  const button = (label: string) =>
    (Array.from(host().querySelectorAll('button')) as HTMLButtonElement[]).find((element) =>
      element.textContent?.includes(label),
    ) ?? null;

  function type(label: string, value: string): void {
    const field = Array.from(host().querySelectorAll('ui-input')).find((element) =>
      element.textContent?.includes(label),
    );
    const input = field?.querySelector('input');
    if (!input) throw new Error(`No field labelled "${label}"`);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function fillValidForm(): void {
    type('Your name', 'Sam Okafor');
    type('Organization name', 'Northwind Design');
    type('Work email', 'sam@northwind.test');
    type('Password', 'correct-horse-battery');
  }

  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    localStorage.clear();
    api = new FakeApi();
    await TestBed.configureTestingModule({
      imports: [Signup],
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: ApiClient, useValue: api as unknown as ApiClient },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Signup);
    fixture.detectChanges();
  });

  afterEach(() => localStorage.clear());

  it('asks for a name and an organization name, not just credentials', () => {
    expect(text()).toContain('Your name');
    expect(text()).toContain('Organization name');
  });

  it('explains what the org name is for, since v1 has no join-an-org path', () => {
    expect(text()).toContain('Shown on reports and shared with everyone you invite.');
  });

  it('creates the account and reports it', async () => {
    let authenticated = 0;
    fixture.componentInstance.authenticated.subscribe(() => authenticated++);

    fillValidForm();
    button('Create organization')!.click();
    await settle();

    expect(api.posts).toEqual([
      {
        path: '/auth/signup',
        body: {
          email: 'sam@northwind.test',
          password: 'correct-horse-battery',
          name: 'Sam Okafor',
          orgName: 'Northwind Design',
        },
      },
    ]);
    expect(TestBed.inject(Session).isAuthenticated()).toBe(true);
    expect(authenticated).toBe(1);
  });

  it('names every missing field at once rather than one at a time', async () => {
    button('Create organization')!.click();
    await settle();

    expect(api.posts).toEqual([]);
    expect(text()).toContain('Tell us what to call you.');
    expect(text()).toContain('Give the organization a name');
    expect(text()).toContain('An email address is needed');
    expect(text()).toContain('Choose a password.');
  });

  it('counts out how many characters a short password still needs', async () => {
    type('Your name', 'Sam');
    type('Organization name', 'Northwind');
    type('Work email', 'sam@northwind.test');
    type('Password', 'shortpass'); // 9 of 12
    button('Create organization')!.click();
    await settle();

    expect(api.posts).toEqual([]);
    expect(text()).toContain('3 more characters needed');
    expect(text()).toContain(String(MIN_PASSWORD_LENGTH));
  });

  it('mirrors the backend minimum, so the rejection never comes from a round-trip', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
  });

  it('turns a taken email into an actionable next step', async () => {
    api.reply = () => {
      throw new ApiError('Conflict', 409, null);
    };
    fillValidForm();
    button('Create organization')!.click();
    await settle();

    const alert = host().querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Sign in instead');
  });

  it('passes the server’s own validation message through unchanged', async () => {
    api.reply = () => {
      throw new ApiError('Password must be at least 12 characters.', 400, null);
    };
    fillValidForm();
    button('Create organization')!.click();
    await settle();

    expect(text()).toContain('Password must be at least 12 characters.');
  });

  it('offers a way back to sign-in without owning the route name', () => {
    let asked = 0;
    fixture.componentInstance.wantsLogin.subscribe(() => asked++);

    button('Sign in')!.click();

    expect(asked).toBe(1);
  });

  it('renders during SSR', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [Signup],
      providers: [
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: ApiClient, useValue: new FakeApi() as unknown as ApiClient },
      ],
    }).compileComponents();

    const server = TestBed.createComponent(Signup);
    expect(() => server.detectChanges()).not.toThrow();
  });
});
