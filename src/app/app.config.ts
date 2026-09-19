import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { providePrimeNG } from 'primeng/config';

import { routes } from './app.routes';
import { authInterceptor } from './services/auth.interceptor';
import { CreditTrackPreset } from './credittrack-preset';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideAnimationsAsync(),
    providePrimeNG({
      ripple: true,
      // No darkModeSelector override — this leaves PrimeNG on its default
      // `@media (prefers-color-scheme: dark)` behaviour, which is exactly
      // how the app's own dark mode already works (styles.scss switches on
      // the same media query, with no manual toggle anywhere in the app).
      theme: {
        preset: CreditTrackPreset,
      },
    }),
  ]
};
