import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { HttpClient, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { provideMarkdown, MARKED_OPTIONS } from 'ngx-markdown';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withInterceptorsFromDi()),
    provideMarkdown({ loader: HttpClient }),
    {
      provide: MARKED_OPTIONS,
      useValue: {
        gfm: true,
        breaks: false,
        pedantic: false,
        smartypants: false,
      },
    }
  ]
};
