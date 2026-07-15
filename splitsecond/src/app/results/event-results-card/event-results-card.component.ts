import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import {
  IonBadge,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
} from '@ionic/angular/standalone';
import { EventResultsViewModel } from '../result.model';
import { ResultRowComponent } from '../result-row/result-row.component';

// Presentational: one event's completed results, ranked by place — the "event wise / gender wise"
// grouping level (the event's own gender/age group are folded into its title already).
@Component({
  selector: 'app-event-results-card',
  templateUrl: './event-results-card.component.html',
  styleUrls: ['./event-results-card.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonBadge, ResultRowComponent],
})
export class EventResultsCardComponent {
  readonly event = input.required<EventResultsViewModel>();
}
