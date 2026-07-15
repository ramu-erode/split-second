import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonRefresher,
  IonRefresherContent,
  IonSearchbar,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { MeetDataStore } from '../../core/data/meet-data.store';
import { MeetSwitcherComponent } from '../../core/meet-switcher/meet-switcher.component';
import { HeatCardComponent } from '../heat-card/heat-card.component';
import { HeatCardViewModel } from '../heat-card/heat-card.model';
import { buildHeatViewModels, filterHeatViewModels } from './heat-view-model.builder';

const COMING_UP_LIMIT = 5;

@Component({
  selector: 'app-upcoming',
  templateUrl: './upcoming.page.html',
  styleUrls: ['./upcoming.page.scss'],
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
    IonSearchbar,
    HeatCardComponent,
    MeetSwitcherComponent,
  ],
})
export class UpcomingPage implements OnInit {
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

  readonly myTeamHeats = computed(() =>
    this.allHeats().filter((h) => h.status !== 'completed' && h.lanes.some((l) => l.isMyTeam))
  );

  readonly comingUpHeats = computed(() =>
    this.allHeats()
      .filter((h) => h.status !== 'completed' && !h.lanes.some((l) => l.isMyTeam))
      .slice(0, COMING_UP_LIMIT)
  );

  readonly completedHeats = computed(() =>
    this.allHeats().filter((h) => h.status === 'completed')
  );

  readonly showCompleted = signal(false);

  readonly searchText = signal('');

  readonly searchResults = computed<HeatCardViewModel[] | null>(() => {
    const q = this.searchText();
    return q.trim() ? filterHeatViewModels(this.allHeats(), q) : null;
  });

  onSearchInput(value: string | null | undefined): void {
    this.searchText.set(value ?? '');
  }

  toggleShowCompleted(): void {
    this.showCompleted.set(!this.showCompleted());
  }

  async ngOnInit(): Promise<void> {
    await this.store.load();
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
