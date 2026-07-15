import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import {
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { AuthService } from '../core/auth/auth.service';

@Component({
  selector: 'app-more',
  templateUrl: './more.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonHeader, IonToolbar, IonTitle, IonContent, IonList, IonItem, IonLabel],
})
export class MorePage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly coach = this.auth.coach;

  async signOut(): Promise<void> {
    await this.auth.logOut();
    await this.router.navigateByUrl('/login');
  }
}
