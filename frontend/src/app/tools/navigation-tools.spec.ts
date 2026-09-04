import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_DESTINATIONS } from '@actuo/shared';
import { NavigationTools } from './navigation-tools.js';

describe('NavigationTools', () => {
  let router: { navigateByUrl: ReturnType<typeof vi.fn>; url: string };
  let tools: NavigationTools;

  /** Lands wherever it was sent, which is the happy path. */
  function landsWhereSent() {
    router.navigateByUrl.mockImplementation((url: string) => {
      router.url = url;
      return Promise.resolve(true);
    });
  }

  beforeEach(() => {
    router = { navigateByUrl: vi.fn(), url: '/dashboard' };
    landsWhereSent();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: Router, useValue: router }],
    });
    tools = TestBed.inject(NavigationTools);
  });

  function run(destination: string) {
    return tools.navigateTo().execute({ destination }, { signal: new AbortController().signal });
  }

  describe('the contract', () => {
    /**
     * It reads and writes nothing, but it changes what the user is looking at,
     * and a client deciding whether to announce an action needs to be told.
     * Same category as the embedded converter's UI-moving tools.
     */
    it('is not read-only, and needs no confirmation', () => {
      const { contract } = tools.navigateTo();
      expect(contract.annotations.readOnlyHint).toBe(false);
      expect(contract.requiresConfirmation).toBe(false);
    });

    it('offers every destination in the schema enum', () => {
      const properties = tools.navigateTo().contract.inputSchema['properties'] as {
        destination: { enum: string[]; description: string };
      };
      expect(properties.destination.enum).toEqual(APP_DESTINATIONS.map((d) => d.id));
    });

    /**
     * The descriptions are the feature: an agent reading `getTools()` should
     * learn what is on each page without opening any of them.
     */
    it('describes each destination to the model', () => {
      const properties = tools.navigateTo().contract.inputSchema['properties'] as {
        destination: { description: string };
      };
      for (const destination of APP_DESTINATIONS) {
        expect(properties.destination.description).toContain(destination.description);
      }
    });
  });

  describe('navigating', () => {
    it('sends the browser to the destination it was asked for', async () => {
      const result = await run('budgets');

      expect(router.navigateByUrl).toHaveBeenCalledWith('/budgets');
      expect(result).toMatchObject({ destination: 'budgets', path: '/budgets', redirected: false });
    });

    it('reaches every declared destination', async () => {
      for (const destination of APP_DESTINATIONS) {
        await run(destination.id);
        expect(router.navigateByUrl).toHaveBeenCalledWith(destination.path);
      }
    });

    /**
     * The enum in a JSON Schema is a hint to the model, not a guarantee about
     * what arrives. A value that is not in the table must fail here rather than
     * reaching `navigateByUrl`, which would take any path at all.
     */
    it('refuses a destination it does not know, and says what it accepts', async () => {
      await expect(run('/etc/passwd')).rejects.toThrow(/Unknown destination/);
      await expect(run('/etc/passwd')).rejects.toThrow(/budgets/);
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    /**
     * LOAD-BEARING. A guard can redirect — an expired session lands on
     * `/login` — and a model told it reached the budgets page while the user
     * stares at a login form will keep building on that mistake. The router is
     * read back afterwards precisely so the answer cannot be wrong.
     */
    it('reports where it actually landed when a guard redirects', async () => {
      router.navigateByUrl.mockImplementation(() => {
        router.url = '/login';
        return Promise.resolve(false);
      });

      const result = await run('budgets');

      expect(result).toMatchObject({ path: '/login', redirected: true });
      expect(JSON.stringify(result)).toContain('redirected');
    });

    it('ignores query and fragment when reporting the landing path', async () => {
      router.navigateByUrl.mockImplementation(() => {
        router.url = '/expenses?status=submitted';
        return Promise.resolve(true);
      });

      const result = await run('expenses');

      expect(result).toMatchObject({ path: '/expenses', redirected: false });
    });
  });

  it('publishes exactly the navigation tool', () => {
    expect(tools.all().map((tool) => tool.contract.name)).toEqual(['navigate_to']);
  });
});
