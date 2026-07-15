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
  selector: 'app-signup',
  templateUrl: './signup.page.html',
  styleUrls: ['./signup.page.scss'],
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
export class SignupPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly displayName = signal('');
  readonly email = signal('');
  readonly password = signal('');
  readonly submitting = signal(false);
  readonly error = this.auth.error;

  async submit(): Promise<void> {
    if (this.submitting()) return;
    this.submitting.set(true);
    try {
      await this.auth.signUp(this.email(), this.password(), this.displayName());
      if (this.auth.isAuthenticated()) await this.router.navigateByUrl('/tabs/upcoming');
    } finally {
      this.submitting.set(false);
    }
  }
}
