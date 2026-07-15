import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { ActionSheetButton, IonActionSheet, IonButton, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { swapHorizontalOutline } from 'ionicons/icons';
import { Meet } from '../models/domain.models';

// Presentational: a coach can have more than one meet live/published at once (e.g. parallel
// age-group championships) and needs a quick way to see which one they're on and switch.
@Component({
  selector: 'app-meet-switcher',
  templateUrl: './meet-switcher.component.html',
  styleUrls: ['./meet-switcher.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonButton, IonIcon, IonActionSheet],
})
export class MeetSwitcherComponent {
  readonly meets = input.required<Meet[]>();
  readonly selectedMeetId = input<string | null>(null);
  readonly meetSelected = output<string>();

  readonly isOpen = signal(false);

  readonly currentMeetName = computed(
    () => this.meets().find((m) => m.id === this.selectedMeetId())?.name ?? 'Select meet'
  );

  readonly buttons = computed<ActionSheetButton[]>(() => [
    ...this.meets().map((m) => ({
      text: m.name,
      handler: () => this.meetSelected.emit(m.id),
    })),
    { text: 'Cancel', role: 'cancel' },
  ]);

  constructor() {
    addIcons({ swapHorizontalOutline });
  }

  open(): void {
    this.isOpen.set(true);
  }
}
