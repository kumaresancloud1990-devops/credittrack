import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

/** Attaches the shared family passcode header to every request that goes
 * to this app's own backend API. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(environment.apiBaseUrl)) {
    return next(req);
  }
  const auth = inject(AuthService);
  const key = auth.familyKey();
  if (!key) {
    return next(req);
  }
  return next(req.clone({ setHeaders: { 'x-family-key': key } }));
};
