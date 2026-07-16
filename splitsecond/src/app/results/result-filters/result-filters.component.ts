import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IonSelect, IonSelectOption } from '@ionic/angular/standalone';
import { EventOption, TeamOption } from '../result.model';

// Presentational: team / age group / gender / event filters for the results list. Event differs
// from the other three — it has no "all" option, since it picks the single event displayed rather
// than narrowing a list (see ResultsPage.displayedEvent).
@Component({
  selector: 'app-result-filters',
  templateUrl: './result-filters.component.html',
  styleUrls: ['./result-filters.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonSelect, IonSelectOption],
})
export class ResultFiltersComponent {
  readonly teams = input.required<TeamOption[]>();
  readonly ageGroups = input.required<string[]>();
  readonly genders = input.required<string[]>();
  readonly events = input.required<EventOption[]>();
  readonly selectedTeamId = input<string | null>(null);
  readonly selectedAgeGroup = input<string | null>(null);
  readonly selectedGender = input<string | null>(null);
  readonly selectedEventId = input<string | null>(null);

  readonly teamIdChanged = output<string | null>();
  readonly ageGroupChanged = output<string | null>();
  readonly genderChanged = output<string | null>();
  readonly eventIdChanged = output<string | null>();
}
