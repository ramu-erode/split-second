import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  IonButton,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonText,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonButton,
    IonContent,
    IonHeader,
    IonInput,
    IonItem,
    IonText,
    IonTitle,
    IonToolbar,
    RouterLink,
  ],
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly email = signal('');
  readonly password = signal('');
  readonly submitting = signal(false);
  readonly error = this.auth.error;

  async submit(): Promise<void> {
    if (this.submitting()) return;
    this.submitting.set(true);
    try {
      await this.auth.logIn(this.email(), this.password());
      if (this.auth.isAuthenticated()) await this.router.navigateByUrl('/tabs/upcoming');
    } finally {
      this.submitting.set(false);
    }
  }
}
