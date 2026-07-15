import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import {
  IonBadge,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonChip,
  IonLabel,
} from '@ionic/angular/standalone';
import { formatMs } from '../../core/time.util';
import { HeatCardViewModel } from './heat-card.model';

@Component({
  selector: 'app-heat-card',
  templateUrl: './heat-card.component.html',
  styleUrls: ['./heat-card.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonBadge, IonChip, IonLabel],
})
export class HeatCardComponent {
  readonly heat = input.required<HeatCardViewModel>();
  readonly heatSelected = output<string>();

  readonly statusLabel = computed(() => {
    switch (this.heat().status) {
      case 'in_progress':
        return 'Now swimming';
      case 'completed':
        return 'Completed';
      default:
        return 'Upcoming';
    }
  });

  readonly statusColor = computed(() => {
    switch (this.heat().status) {
      case 'in_progress':
        return 'success';
      case 'completed':
        return 'medium';
      default:
        return 'primary';
    }
  });

  formatTime(ms: number | null): string {
    return formatMs(ms);
  }
}
