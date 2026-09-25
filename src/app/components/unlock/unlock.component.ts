import { Component, signal } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';

/** Unlike the app this is mirrored from (single fixed account, no
 * registration), this one lets a first-time visitor create their own
 * account — so this component toggles between a login form and a
 * registration form rather than only ever showing one. Whichever way
 * someone gets in, they land on the exact same shared demo dataset; see
 * AuthService's doc comment. */
@Component({
    selector: 'app-unlock',
    imports: [FormsModule],
    templateUrl: './unlock.component.html',
    styleUrl: './unlock.component.scss'
})
export class UnlockComponent {
  readonly mode = signal<'login' | 'register'>('login');

  readonly username = signal('');
  readonly password = signal('');
  readonly confirmPassword = signal('');

  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);

  constructor(private auth: AuthService) {}

  switchMode(mode: 'login' | 'register'): void {
    if (this.mode() === mode) return;
    this.mode.set(mode);
    // A stale error or half-typed confirm-password from the form someone
    // just left doesn't carry over into the one they're switching to.
    this.error.set(null);
    this.confirmPassword.set('');
  }

  async submit(): Promise<void> {
    const username = this.username().trim();
    const password = this.password();
    if (!username || !password) return;

    if (this.mode() === 'register' && password !== this.confirmPassword()) {
      this.error.set('Passwords do not match.');
      return;
    }

    this.submitting.set(true);
    this.error.set(null);
    try {
      if (this.mode() === 'register') {
        await this.auth.register(username, password);
      } else {
        await this.auth.login(username, password);
      }
    } catch (err) {
      const fallback = this.mode() === 'register' ? 'Could not create the account.' : 'Could not sign in.';
      this.error.set(err instanceof Error ? err.message : fallback);
    } finally {
      this.submitting.set(false);
    }
  }
}
