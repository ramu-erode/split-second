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
import { EventResultsViewModel } from './result.model';
import {
  buildEventResults,
  distinctAgeGroups,
  distinctGenders,
  distinctTeams,
  filterEventResults,
} from './result-view-model.builder';

// The candidate whose first recorded time is most recent — i.e. the last event to newly qualify
// as "completed" — used as the Results event dropdown's default pick.
function mostRecentlyCompleted(candidates: EventResultsViewModel[]): EventResultsViewModel {
  return candidates.reduce((latest, e) => (e.firstCompletedAt > latest.firstCompletedAt ? e : latest));
}

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
  readonly selectedEventId = signal<string | null>(null);

  // Team/group/gender narrow which events are even candidates; Event itself (below) then picks
  // one of those to actually display — unlike the other three filters, there's no "all events"
  // option, since a whole meet's worth of completed events would otherwise mean a long card-per-
  // event list instead of one focused result at a time.
  readonly filteredEvents = computed(() =>
    filterEventResults(this.eventResults(), {
      teamId: this.selectedTeamId(),
      ageGroup: this.selectedAgeGroup(),
      gender: this.selectedGender(),
    })
  );

  readonly eventOptions = computed(() =>
    this.filteredEvents().map((e) => ({ id: e.eventId, title: e.eventTitle }))
  );

  // Defaults to the most recently completed candidate event (the last one to get its first
  // recorded time) whenever nothing's explicitly picked yet, or the prior pick fell out of the
  // candidate set (e.g. a team/group/gender filter changed) — self-healing, no effect needed.
  readonly displayedEvent = computed(() => {
    const candidates = this.filteredEvents();
    if (candidates.length === 0) return null;
    const selected = candidates.find((e) => e.eventId === this.selectedEventId());
    return selected ?? mostRecentlyCompleted(candidates);
  });

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
