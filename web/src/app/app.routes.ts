import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/landing/landing').then(m => m.Landing) },
  { path: 'patterns', loadComponent: () => import('./pages/patterns/patterns').then(m => m.Patterns) },
  { path: 'patterns/:section', loadComponent: () => import('./pages/patterns/patterns').then(m => m.Patterns) },
  { path: 'patterns/:section/:id', loadComponent: () => import('./pages/pattern/pattern').then(m => m.Pattern) },
  { path: 'patterns/:section/:id/story', loadComponent: () => import('./pages/user-story/user-story').then(m => m.UserStory) },
  { path: 'patterns/:section/:id/example', loadComponent: () => import('./pages/example/example').then(m => m.Example) }
];
