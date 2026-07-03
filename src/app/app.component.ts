import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ExternalStorageBannerComponent } from './components/external-storage-banner/external-storage-banner.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, ExternalStorageBannerComponent],
  template: `
    <router-outlet />
    <app-external-storage-banner />
  `,
  styles: [':host{display:block;min-height:100vh}'],
})
export class AppComponent {}
