import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IonBadge, IonItem, IonLabel } from '@ionic/angular/standalone';
import { TeamStandingViewModel } from './standing-row.model';

@Component({
  selector: 'app-standing-row',
  templateUrl: './standing-row.component.html',
  styleUrls: ['./standing-row.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonItem, IonLabel, IonBadge],
})
export class StandingRowComponent {
  readonly rank = input.required<number>();
  readonly standing = input.required<TeamStandingViewModel>();
}
