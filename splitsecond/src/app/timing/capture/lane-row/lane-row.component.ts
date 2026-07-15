import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import {
  IonBadge,
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonCheckbox,
  IonChip,
  IonIcon,
  IonLabel,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { backspaceOutline, checkmarkOutline, flagOutline, refreshOutline } from 'ionicons/icons';
import { formatDigitsPreview, formatMs, parseMsFromDigits } from '../../../core/time.util';
import { LaneRowViewModel } from './lane-row.model';

// Calculator/price-entry style keypad: digits fill in right-anchored (hundredths, then seconds,
// then minutes), same convention as time.util's parseMsFromDigits/formatDigitsPreview.
const MANUAL_DIGITS_MAX = 6;

// Presentational: one lane's controls in the capture screen. The master clock and this lane's
// in-progress capture state (splits/finished/selected) are all owned by the capture page — this
// component only renders them and emits taps (CLAUDE.md smart/dumb split). High-contrast, large
// tap targets per CLAUDE.md's timing-screen guidance (used under time pressure on a bright deck).
@Component({
  selector: 'app-lane-row',
  templateUrl: './lane-row.component.html',
  styleUrls: ['./lane-row.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
    IonBadge,
    IonChip,
    IonLabel,
    IonButton,
    IonIcon,
    IonCheckbox,
  ],
})
export class LaneRowComponent {
  readonly lane = input.required<LaneRowViewModel>();
  readonly captureEnabled = input.required<boolean>();

  readonly lapTapped = output<void>();
  readonly finishTapped = output<void>();
  readonly undoTapped = output<void>();
  readonly selectToggled = output<void>();
  readonly manualFinishTapped = output<number>();

  readonly manualMode = signal(false);
  readonly manualDigits = signal('');
  readonly manualPreview = computed(() => formatDigitsPreview(this.manualDigits()));

  // The most recent split (or the finished time once locked) — this lane's headline badge.
  readonly latestTimeMs = computed(() => {
    const lane = this.lane();
    if (lane.isFinished) return lane.finishedFinalTimeMs;
    return lane.splits.length ? lane.splits[lane.splits.length - 1] : null;
  });

  constructor() {
    addIcons({ flagOutline, checkmarkOutline, refreshOutline, backspaceOutline });
  }

  toggleManualMode(): void {
    this.manualMode.set(!this.manualMode());
    this.manualDigits.set('');
  }

  appendDigit(digit: string): void {
    if (this.manualDigits().length >= MANUAL_DIGITS_MAX) return;
    this.manualDigits.set(this.manualDigits() + digit);
  }

  backspaceDigit(): void {
    this.manualDigits.set(this.manualDigits().slice(0, -1));
  }

  clearDigits(): void {
    this.manualDigits.set('');
  }

  saveManualTime(): void {
    const finalTimeMs = parseMsFromDigits(this.manualDigits());
    if (finalTimeMs == null) return;
    this.manualFinishTapped.emit(finalTimeMs);
    this.manualDigits.set('');
    this.manualMode.set(false);
  }

  formatTime(ms: number | null): string {
    return formatMs(ms);
  }
}
