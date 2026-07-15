import { Routes } from '@angular/router';
import { TabsPage } from './tabs.page';

export const tabsRoutes: Routes = [
  {
    path: '',
    component: TabsPage,
    children: [
      {
        path: 'upcoming',
        loadComponent: () =>
          import('../order-of-events/upcoming/upcoming.page').then((m) => m.UpcomingPage),
      },
      {
        path: 'timing',
        loadChildren: () => import('../timing/timing.routes').then((m) => m.timingRoutes),
      },
      {
        path: 'leaderboard',
        loadComponent: () =>
          import('../leaderboard/leaderboard.page').then((m) => m.LeaderboardPage),
      },
      {
        path: 'results',
        loadComponent: () => import('../results/results.page').then((m) => m.ResultsPage),
      },
      { path: 'more', loadComponent: () => import('../more/more.page').then((m) => m.MorePage) },
      { path: '', redirectTo: 'upcoming', pathMatch: 'full' },
    ],
  },
];
