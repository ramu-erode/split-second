import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import {
  IonButtons,
  IonContent,
  IonHeader,
  IonRefresher,
  IonRefresherContent,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { MeetDataStore } from '../core/data/meet-data.store';
import { MeetSwitcherComponent } from '../core/meet-switcher/meet-switcher.component';
import { EventResultsCardComponent } from './event-results-card/event-results-card.component';
import { ResultFiltersComponent } from './result-filters/result-filters.component';
import {
  buildEventResults,
  distinctAgeGroups,
  distinctGenders,
  distinctTeams,
  filterEventResults,
} from './result-view-model.builder';

// Team wise / group wise / event wise / gender wise / swimmer wise completed results, with each
// swimmer's seed time and splits alongside their final time — a coach's post-race reference, not a
// live-timing screen (that's Timing) or a standings screen (that's Leaderboard).
@Component({
  selector: 'app-results',
  templateUrl: './results.page.html',
  styleUrls: ['./results.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonContent,
    IonRefresher,
    IonRefresherContent,
    ResultFiltersComponent,
    EventResultsCardComponent,
    MeetSwitcherComponent,
  ],
})
export class ResultsPage implements OnInit {
  private readonly store = inject(MeetDataStore);

  readonly status = this.store.status;
  readonly meet = this.store.meet;
  readonly availableMeets = this.store.availableMeets;

  private readonly eventResults = computed(() =>
    buildEventResults(
      this.store.events(),
      this.store.lanesByEventId(),
      this.store.observationsByLaneId(),
      this.store.splitsByObservationId(),
      this.store.pointsRowsByTableId(),
      this.store.teamsById(),
      this.store.swimmersById()
    )
  );

  readonly teamOptions = computed(() => distinctTeams(this.eventResults(), this.store.teamsById()));
  readonly ageGroupOptions = computed(() => distinctAgeGroups(this.eventResults()));
  readonly genderOptions = computed(() => distinctGenders(this.eventResults()));

  readonly selectedTeamId = signal<string | null>(null);
  readonly selectedAgeGroup = signal<string | null>(null);
  readonly selectedGender = signal<string | null>(null);

  readonly filteredEvents = computed(() =>
    filterEventResults(this.eventResults(), {
      teamId: this.selectedTeamId(),
      ageGroup: this.selectedAgeGroup(),
      gender: this.selectedGender(),
    })
  );

  async ngOnInit(): Promise<void> {
    if (this.store.status() === 'idle') await this.store.load();
  }

  async refresh(event: CustomEvent): Promise<void> {
    await this.store.load();
    (event.target as HTMLIonRefresherElement)?.complete();
  }

  async onMeetSelected(meetId: string): Promise<void> {
    await this.store.selectMeet(meetId);
  }
}
