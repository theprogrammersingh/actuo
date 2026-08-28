import { PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { AuthSession } from '@actuo/shared';

import { ApiClient, ApiError } from '../../core/api/api-client.js';
import { REFRESH_TOKEN_STORAGE_KEY, Session } from '../../core/session/session.js';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, Login } from './login.js';

const SESSION: AuthSession = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  user: {
    id: 'user-1',
    email: 'priya@actuo.demo',
    name: 'Priya Sharma',
    createdAt: '2026-01-04T09:00:00.000Z',
  },
  orgId: 'org-1',
  role: 'owner',
};

/** Records what the screen asked the API for. No network anywhere. */
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

describe('Login', () => {
  let fixture: ComponentFixture<Login>;
  let api: FakeApi;

  const host = () => fixture.nativeElement as HTMLElement;
  const text = () => host().textContent ?? '';
  const buttons = () => Array.from(host().querySelectorAll('button')) as HTMLButtonElement[];
  const button = (label: string) =>
    buttons().find((element) => element.textContent?.includes(label)) ?? null;

  /** Drives `ui-input`'s ControlValueAccessor the way a person would. */
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

  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    localStorage.clear();
    api = new FakeApi();
    await TestBed.configureTestingModule({
      imports: [Login],
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: ApiClient, useValue: api as unknown as ApiClient },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Login);
    fixture.detectChanges();
  });

  afterEach(() => localStorage.clear());

  it('signs in and reports it, leaving the routing to the shell', async () => {
    let authenticated = 0;
    fixture.componentInstance.authenticated.subscribe(() => authenticated++);

    type('Work email', 'priya@actuo.demo');
    type('Password', 'Demo1234!');
    button('Sign in')!.click();
    await settle();

    expect(api.posts).toEqual([
      { path: '/auth/login', body: { email: 'priya@actuo.demo', password: 'Demo1234!' } },
    ]);
    expect(TestBed.inject(Session).isAuthenticated()).toBe(true);
    expect(authenticated).toBe(1);
  });

  it('validates before it asks the server', async () => {
    button('Sign in')!.click();
    await settle();

    expect(api.posts).toEqual([]);
    expect(text()).toContain('Enter the email address you signed up with.');
    expect(text()).toContain('Enter your password.');
  });

  it('says nothing about validity until a submit is attempted', () => {
    expect(text()).not.toContain('Enter your password.');
  });

  it('catches an address with no @ before a round-trip', async () => {
    type('Work email', 'priya.at.actuo');
    type('Password', 'Demo1234!');
    button('Sign in')!.click();
    await settle();

    expect(api.posts).toEqual([]);
    expect(text()).toContain('does not look like an email address');
  });

  describe('when the credentials are rejected', () => {
    beforeEach(async () => {
      api.reply = () => {
        throw new ApiError('Unauthorized', 401, null);
      };
      type('Work email', 'priya@actuo.demo');
      type('Password', 'wrong');
      button('Sign in')!.click();
      await settle();
    });

    it('shows the specific message in an alert region', () => {
      const alert = host().querySelector('[role="alert"]');
      expect(alert?.textContent).toContain("don't match an Actuo account");
    });

    it('does not tell the user which half they got wrong, or blame them', () => {
      expect(text()).not.toMatch(/your password is/i);
      expect(text()).not.toMatch(/you entered/i);
    });

    it('leaves the session signed out', () => {
      expect(TestBed.inject(Session).isAuthenticated()).toBe(false);
      expect(localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBeNull();
    });
  });

  it('surfaces rate limiting as its own message, not as bad credentials', async () => {
    api.reply = () => {
      throw new ApiError('Too Many Requests', 429, null);
    };
    type('Work email', 'priya@actuo.demo');
    type('Password', 'Demo1234!');
    button('Sign in')!.click();
    await settle();

    expect(text()).toContain('Wait a few minutes');
  });

  describe('demo affordance (PRD §11 — a judge will not sign up)', () => {
    it('stays out of the way until asked for', () => {
      expect(button('Use a demo account')).not.toBeNull();
      expect(text()).not.toContain('priya@actuo.demo');
    });

    it('reveals both seeded roles and the shared password', () => {
      button('Use a demo account')!.click();
      fixture.detectChanges();

      expect(text()).toContain('Priya — owner');
      expect(text()).toContain('Arjun — member');
      expect(text()).toContain(DEMO_PASSWORD);
    });

    it('fills the form visibly and signs in — no hidden credentials', async () => {
      button('Use a demo account')!.click();
      fixture.detectChanges();
      button('Arjun — member')!.click();
      await settle();

      const emailField = Array.from(host().querySelectorAll('ui-input'))
        .find((element) => element.textContent?.includes('Work email'))
        ?.querySelector('input');

      expect(emailField?.value).toBe('arjun@actuo.demo');
      expect(api.posts).toEqual([
        { path: '/auth/login', body: { email: 'arjun@actuo.demo', password: DEMO_PASSWORD } },
      ]);
    });

    it('offers exactly the two accounts that exist in the seed', () => {
      expect(DEMO_ACCOUNTS.map((account) => account.email)).toEqual([
        'priya@actuo.demo',
        'arjun@actuo.demo',
      ]);
    });
  });

  it('offers a way to reach sign-up without owning the route name', () => {
    let asked = 0;
    fixture.componentInstance.wantsSignup.subscribe(() => asked++);

    button('Create an organization')!.click();

    expect(asked).toBe(1);
  });

  it('renders without a session during SSR', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [Login],
      providers: [
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: ApiClient, useValue: new FakeApi() as unknown as ApiClient },
      ],
    }).compileComponents();

    const server = TestBed.createComponent(Login);
    expect(() => server.detectChanges()).not.toThrow();
  });
});
