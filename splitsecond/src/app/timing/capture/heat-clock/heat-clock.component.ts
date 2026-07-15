import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { IonButton, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { playOutline, stopOutline } from 'ionicons/icons';
import { formatMs } from '../../../core/time.util';

// Presentational: the heat's single shared clock (CLAUDE.md: "one physical heat = one start/gun =
// one timing session" — every lane reads off this same clock rather than running its own).
@Component({
  selector: 'app-heat-clock',
  templateUrl: './heat-clock.component.html',
  styleUrls: ['./heat-clock.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonButton, IonIcon],
})
export class HeatClockComponent {
  readonly running = input.required<boolean>();
  readonly elapsedMs = input.required<number>();

  readonly startAll = output<void>();
  readonly stopAll = output<void>();

  readonly elapsedDisplay = computed(() => formatMs(this.elapsedMs()));

  constructor() {
    addIcons({ playOutline, stopOutline });
  }
}
