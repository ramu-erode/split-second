import { Routes } from '@angular/router';

export const timingRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./heat-select/heat-select.page').then((m) => m.HeatSelectPage),
  },
  {
    path: ':heatId',
    loadComponent: () => import('./capture/capture.page').then((m) => m.CapturePage),
  },
];
