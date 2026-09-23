import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SidebarComponent } from './components/sidebar/sidebar.component';
import { UnlockComponent } from './components/unlock/unlock.component';
import { AuthService } from './services/auth.service';
import { DataService } from './services/data.service';

@Component({
    selector: 'app-root',
    imports: [RouterOutlet, SidebarComponent, UnlockComponent],
    templateUrl: './app.component.html',
    styleUrl: './app.component.scss'
})
export class AppComponent {
  title = 'CrediTrack';

  constructor(public auth: AuthService, public data: DataService) {}
}
