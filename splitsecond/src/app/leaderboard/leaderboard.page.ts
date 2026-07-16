import { ChangeDetectionStrategy, Component, OnInit, computed, inject } from '@angular/core';
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
import { GroupStandingsCardComponent } from './group-standings-card/group-standings-card.component';
import { buildGroupStandings } from './group-standings.builder';
import { GroupStandingsViewModel } from './group-standings.model';

@Component({
  selector: 'app-leaderboard',
  templateUrl: './leaderboard.page.html',
  styleUrls: ['./leaderboard.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonContent,
    IonRefresher,
    IonRefresherContent,
    GroupStandingsCardComponent,
    MeetSwitcherComponent,
  ],
})
export class LeaderboardPage implements OnInit {
  private readonly store = inject(MeetDataStore);

  readonly status = this.store.status;
  readonly meet = this.store.meet;
  readonly availableMeets = this.store.availableMeets;

  // Standings are computed per age group + gender, never consolidated into one combined total — a
  // team entered in more groups would otherwise win purely by volume, not performance.
  readonly groupedStandings = computed<GroupStandingsViewModel[]>(() =>
    buildGroupStandings(
      this.store.events(),
      this.store.lanesByEventId(),
      this.store.observationsByLaneId(),
      this.store.pointsRowsByTableId(),
      this.store.teamsById()
    )
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
