import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-unlock',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './unlock.component.html',
  styleUrl: './unlock.component.scss',
})
export class UnlockComponent {
  readonly passcode = signal('');

  constructor(private auth: AuthService) {}

  submit(): void {
    const value = this.passcode().trim();
    if (!value) return;
    this.auth.setKey(value);
  }
}
