import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./auth/login/login.page').then((m) => m.LoginPage) },
  {
    path: 'signup',
    loadComponent: () => import('./auth/signup/signup.page').then((m) => m.SignupPage),
  },
  {
    path: 'tabs',
    canActivate: [authGuard],
    loadChildren: () => import('./tabs/tabs.routes').then((m) => m.tabsRoutes),
  },
  { path: '', redirectTo: 'tabs', pathMatch: 'full' },
];
