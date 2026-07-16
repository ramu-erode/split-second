import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { IonButton, IonList } from '@ionic/angular/standalone';
import { GroupStandingsViewModel } from '../group-standings.model';
import { StandingRowComponent } from '../standing-row/standing-row.component';

const PAGE_SIZE = 5;

// Presentational: one (age group, gender) bucket's standings, paginated 5-at-a-time rather than
// dumping every team on screen — a group with 20+ teams would otherwise make the leaderboard a
// long scroll. Page position is pure display state, so it's owned locally rather than lifted to
// LeaderboardPage.
@Component({
  selector: 'app-group-standings-card',
  templateUrl: './group-standings-card.component.html',
  styleUrls: ['./group-standings-card.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonList, IonButton, StandingRowComponent],
})
export class GroupStandingsCardComponent {
  readonly group = input.required<GroupStandingsViewModel>();

  private readonly _page = signal(0);

  readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.group().standings.length / PAGE_SIZE))
  );
  // Clamps rather than resetting on data changes — self-heals if a group shrinks (or this
  // component instance is reused for a different group) without needing an effect.
  readonly page = computed(() => Math.min(this._page(), this.totalPages() - 1));
  readonly startRank = computed(() => this.page() * PAGE_SIZE + 1);
  readonly pageStandings = computed(() => {
    const start = this.page() * PAGE_SIZE;
    return this.group().standings.slice(start, start + PAGE_SIZE);
  });

  previousPage(): void {
    this._page.set(Math.max(0, this.page() - 1));
  }

  nextPage(): void {
    this._page.set(Math.min(this.totalPages() - 1, this.page() + 1));
  }
}
