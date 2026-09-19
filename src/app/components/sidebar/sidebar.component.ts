import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { MessageModule } from 'primeng/message';
import { GoogleDriveService } from '../../services/google-drive.service';
import { ExcelService } from '../../services/excel.service';
import { DataService } from '../../services/data.service';
import { AuthService } from '../../services/auth.service';

interface NavItem {
  path: string;
  label: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { path: '/dashboard', label: 'Dashboard', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { path: '/active-loans', label: 'Active Loans', icon: 'M3 4h18v16H3z M3 10h18' },
  { path: '/closed-loans', label: 'Closed Loans', icon: 'M9 12l2 2 4-4 M12 21a9 9 0 100-18 9 9 0 000 18z' },
  { path: '/monthly-spends', label: 'Monthly Spends', icon: 'M3 5h18v15H3z M3 9h18 M8 3v4 M16 3v4' },
  { path: '/emi-calculator', label: 'EMI Calculator', icon: 'M4 3h16v18H4z M8 8h8 M8 12h3 M8 16h3 M14 12h2 M14 16h2' },
];

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, ButtonModule, TagModule, MessageModule],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
})
export class SidebarComponent {
  readonly navItems = NAV_ITEMS;
  readonly signingIn = signal(false);
  readonly signInError = signal<string | null>(null);
  readonly exporting = signal(false);
  readonly exportMessage = signal<string | null>(null);

  constructor(
    public drive: GoogleDriveService,
    private excel: ExcelService,
    public data: DataService,
    private auth: AuthService
  ) {}

  signOut(): void {
    if (confirm('Sign out and clear the family passcode from this browser tab?')) {
      this.auth.signOut();
    }
  }

  async signIn(): Promise<void> {
    this.signInError.set(null);
    this.signingIn.set(true);
    try {
      await this.drive.signIn();
    } catch (err) {
      this.signInError.set(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      this.signingIn.set(false);
    }
  }

  async exportExcel(): Promise<void> {
    this.exporting.set(true);
    this.exportMessage.set(null);
    try {
      await this.excel.exportAndDownload();
      if (this.drive.isSignedIn()) {
        try {
          const blob = await this.excel.buildWorkbookBlob();
          await this.drive.uploadExcelSnapshot(blob, this.excel.getFilename());
          this.exportMessage.set('Downloaded and saved a copy to Drive.');
        } catch (err) {
          this.exportMessage.set('Downloaded locally — Drive upload failed.');
        }
      } else {
        this.exportMessage.set('Downloaded to your device.');
      }
    } catch (err) {
      this.exportMessage.set('Export failed — please try again.');
    } finally {
      this.exporting.set(false);
      setTimeout(() => this.exportMessage.set(null), 4000);
    }
  }
}
