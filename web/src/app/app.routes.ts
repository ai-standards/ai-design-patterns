import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/landing/landing').then(m => m.Landing) },
  { path: 'patterns', loadComponent: () => import('./pages/patterns/patterns').then(m => m.Patterns) },
  { path: 'patterns/:id', loadComponent: () => import('./pages/pattern/pattern').then(m => m.Pattern) }
];
