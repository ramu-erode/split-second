import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import {
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { AuthService } from '../core/auth/auth.service';
import { MeetDataStore } from '../core/data/meet-data.store';

@Component({
  selector: 'app-more',
  templateUrl: './more.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonList,
    IonItem,
    IonLabel,
    IonSpinner,
  ],
})
export class MorePage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly meetDataStore = inject(MeetDataStore);

  readonly coach = this.auth.coach;
  readonly syncing = this.meetDataStore.syncing;
  readonly syncError = this.meetDataStore.syncError;

  // Absolute rather than relative time — avoids needing a ticking interval to keep a "3 min ago"
  // label current while this page is open.
  readonly lastSyncedLabel = computed(() => {
    const syncedAt = this.meetDataStore.lastSyncedAt();
    if (!syncedAt) return 'Not yet synced on this device';
    return `Last synced ${new Date(syncedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  });

  async signOut(): Promise<void> {
    await this.auth.logOut();
    await this.router.navigateByUrl('/login');
  }

  async refreshMeetData(): Promise<void> {
    await this.meetDataStore.hardRefresh();
  }
}
