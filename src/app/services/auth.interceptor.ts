import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

/** Attaches the logged-in username + password headers to every request
 * that goes to this app's own backend API (see server/index.js's AUTH
 * NOTE — checked fresh against the database on every request). */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(environment.apiBaseUrl)) {
    return next(req);
  }
  const auth = inject(AuthService);
  const username = auth.username();
  const password = auth.password();
  if (!username || !password) {
    return next(req);
  }
  return next(req.clone({ setHeaders: { 'x-username': username, 'x-password': password } }));
};
