import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IonBadge, IonChip, IonLabel } from '@ionic/angular/standalone';
import { formatMs } from '../../core/time.util';
import { ResultViewModel } from '../result.model';

// Presentational: one swimmer's (or relay lane's) completed result — place, final time, seed time,
// the delta between them, and splits.
@Component({
  selector: 'app-result-row',
  templateUrl: './result-row.component.html',
  styleUrls: ['./result-row.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonChip, IonLabel, IonBadge],
})
export class ResultRowComponent {
  readonly result = input.required<ResultViewModel>();

  formatTime(ms: number | null): string {
    return formatMs(ms);
  }

  formatDelta(ms: number | null): string {
    if (ms == null) return '—';
    if (ms === 0) return '±0.00';
    const sign = ms > 0 ? '+' : '−';
    return `${sign}${formatMs(Math.abs(ms))}`;
  }
}
