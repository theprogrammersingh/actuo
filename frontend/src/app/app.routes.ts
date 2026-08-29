import type { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/session/auth-guard.js';

/**
 * Every authenticated view is lazily loaded, so the public landing page ships
 * the smallest possible bundle. PRD §8.5 wants the public surface fast and
 * crawlable while the gated app is deliberately not indexed.
 */
export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/landing/landing.js').then((m) => m.Landing),
    title: 'Actuo — AI-native expense intelligence',
  },
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/auth/login.js').then((m) => m.Login),
    title: 'Sign in · Actuo',
  },
  {
    path: 'signup',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/auth/signup.js').then((m) => m.Signup),
    title: 'Create an account · Actuo',
  },
  {
    path: 'dashboard',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/dashboard/dashboard.js').then((m) => m.Dashboard),
    title: 'Dashboard · Actuo',
  },
  {
    path: 'expenses',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/expenses/expenses.js').then((m) => m.Expenses),
    title: 'Expenses · Actuo',
  },
  {
    path: 'add',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/add-expense/add-expense.js').then((m) => m.AddExpense),
    title: 'Add expense · Actuo',
  },
  {
    path: 'budgets',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/budgets/budgets.js').then((m) => m.Budgets),
    title: 'Budgets · Actuo',
  },
  {
    // The WebMCP surface, made visible: what this page publishes, what it can
    // reach on other origins, and every tool call that has run (PRD §7).
    path: 'agent',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/agent/agent.js').then((m) => m.Agent),
    title: 'Agent tools · Actuo',
  },
  {
    path: 'settings',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/settings/settings.js').then((m) => m.Settings),
    title: 'Settings · Actuo',
  },
  {
    // Design Doc §6 deliverable: every component in every state, for eyeballing
    // dark/light parity. Not linked from the app chrome.
    path: 'showcase',
    loadComponent: () => import('./ui/showcase/showcase.js').then((m) => m.Showcase),
    title: 'Component showcase · Actuo',
  },
  { path: '**', redirectTo: '' },
];
