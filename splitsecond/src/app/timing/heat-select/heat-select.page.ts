import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonRefresher,
  IonRefresherContent,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { MeetDataStore } from '../../core/data/meet-data.store';
import { MeetSwitcherComponent } from '../../core/meet-switcher/meet-switcher.component';
import { HeatCardComponent } from '../../order-of-events/heat-card/heat-card.component';
import { buildHeatViewModels } from '../../order-of-events/upcoming/heat-view-model.builder';

// Heat picker for the Timing tab. Any coach may time any lane (ADR-7 — coaches log reference
// times and top-6 points for opposing swimmers too), so this lists every non-completed heat, not
// just the coach's own team's heats. Completed heats are hidden behind a toggle — still reachable
// (e.g. a Scorer reopening one, or reviewing recorded times), just not competing with what's next.
@Component({
  selector: 'app-timing-heat-select',
  templateUrl: './heat-select.page.html',
  styleUrls: ['./heat-select.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButton,
    IonButtons,
    IonContent,
    IonRefresher,
    IonRefresherContent,
    HeatCardComponent,
    MeetSwitcherComponent,
  ],
})
export class HeatSelectPage implements OnInit {
  private readonly store = inject(MeetDataStore);
  private readonly router = inject(Router);

  readonly status = this.store.status;
  readonly meet = this.store.meet;
  readonly availableMeets = this.store.availableMeets;

  private readonly allHeats = computed(() =>
    buildHeatViewModels(
      this.store.physicalHeats(),
      this.store.lanesByHeatId(),
      this.store.eventsById(),
      this.store.heatNoByPhysicalHeatId(),
      this.store.teamsById(),
      this.store.swimmersById()
    )
  );

  readonly heats = computed(() => this.allHeats().filter((h) => h.status !== 'completed'));
  readonly completedHeats = computed(() => this.allHeats().filter((h) => h.status === 'completed'));
  readonly showCompleted = signal(false);

  async ngOnInit(): Promise<void> {
    if (this.store.status() === 'idle') await this.store.load();
  }

  toggleShowCompleted(): void {
    this.showCompleted.set(!this.showCompleted());
  }

  async refresh(event: CustomEvent): Promise<void> {
    await this.store.load();
    (event.target as HTMLIonRefresherElement)?.complete();
  }

  onHeatSelected(heatId: string): void {
    this.router.navigate(['/tabs/timing', heatId]);
  }

  async onMeetSelected(meetId: string): Promise<void> {
    await this.store.selectMeet(meetId);
  }
}
