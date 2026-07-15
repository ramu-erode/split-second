import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IonSelect, IonSelectOption } from '@ionic/angular/standalone';
import { TeamOption } from '../result.model';

// Presentational: the three drill-down filters (team / age group / gender) for the results list.
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
  readonly selectedTeamId = input<string | null>(null);
  readonly selectedAgeGroup = input<string | null>(null);
  readonly selectedGender = input<string | null>(null);

  readonly teamIdChanged = output<string | null>();
  readonly ageGroupChanged = output<string | null>();
  readonly genderChanged = output<string | null>();
}
