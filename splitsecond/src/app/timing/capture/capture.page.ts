import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  IonBackButton,
  IonBadge,
  IonButton,
  IonButtons,
  IonContent,
  IonFooter,
  IonHeader,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { AuthService } from '../../core/auth/auth.service';
import { MeetDataStore } from '../../core/data/meet-data.store';
import { formatEventTitle } from '../../order-of-events/upcoming/heat-view-model.builder';
import { buildLaneRowViewModels } from './capture-view-model.builder';
import { HeatClockComponent } from './heat-clock/heat-clock.component';
import { LaneSession, emptyLaneSession } from './lane-session.model';
import { LaneRowComponent } from './lane-row/lane-row.component';

// The deck timing screen for a single physical heat. One shared master clock (Start All/Stop
// All) drives every lane — CLAUDE.md: "one physical heat = one start/gun = one timing session."
// Each lane's Split/Finish taps read the current master-clock elapsed time; Finish (individually
// or via the bulk "finish selected" action) writes an append-only Observation through
// MeetDataStore — this page never touches Supabase/IndexedDB directly (smart/dumb split).
@Component({
  selector: 'app-timing-capture',
  templateUrl: './capture.page.html',
  styleUrls: ['./capture.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonBackButton,
    IonBadge,
    IonButtons,
    IonFooter,
    IonButton,
    HeatClockComponent,
    LaneRowComponent,
  ],
})
export class CapturePage implements OnInit {
  private readonly store = inject(MeetDataStore);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly heatId = inject(ActivatedRoute).snapshot.paramMap.get('heatId')!;

  readonly status = this.store.status;

  readonly heatRunning = signal(false);
  readonly heatElapsedMs = signal(0);
  // Split/Finish become usable once the clock has been started at least once — including after a
  // Stop All, so the frozen elapsed time can still be used to finish a lane that was missed.
  readonly captureEnabled = computed(() => this.heatRunning() || this.heatElapsedMs() > 0);

  private readonly laneSessions = signal(new Map<string, LaneSession>());
  private readonly selectedLaneIds = signal(new Set<string>());
  readonly selectedCount = computed(() => this.selectedLaneIds().size);

  private heatStartedAt = 0;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  readonly canScore = computed(() => this.auth.coach()?.canScore ?? false);

  readonly heatStatus = computed(
    () => this.store.physicalHeats().find((h) => h.id === this.heatId)?.status ?? 'pending'
  );

  readonly heatStatusLabel = computed(() => {
    switch (this.heatStatus()) {
      case 'in_progress':
        return 'In progress';
      case 'completed':
        return 'Completed';
      default:
        return 'Pending';
    }
  });

  readonly heatStatusColor = computed(() => {
    switch (this.heatStatus()) {
      case 'in_progress':
        return 'success';
      case 'completed':
        return 'medium';
      default:
        return 'light';
    }
  });

  // A heat that's finished on paper (every non-scratched lane has a recorded final time) drives
  // the auto-complete effect below — read from persisted observations, not this page's in-memory
  // laneSessions, so it's correct even right after a reload.
  private readonly activeLanes = computed(() =>
    (this.store.lanesByHeatId().get(this.heatId) ?? []).filter(
      (l) => l.status !== 'scratched' && l.status !== 'no_show'
    )
  );

  private readonly allLanesFinished = computed(() => {
    const lanes = this.activeLanes();
    if (!lanes.length) return false;
    const obsByLaneId = this.store.observationsByLaneId();
    return lanes.every((l) => (obsByLaneId.get(l.id) ?? []).some((o) => o.finalTimeMs !== null));
  });

  // Set by a Scorer's "Reopen heat" tap so the auto-complete effect (which would otherwise see the
  // same still-finished lanes and immediately flip it straight back to completed) backs off until
  // the Scorer explicitly marks it complete again.
  private readonly manualOverrideActive = signal(false);

  readonly heatTitle = computed(() => {
    const lanes = this.store.lanesByHeatId().get(this.heatId) ?? [];
    const eventId = lanes.find((l) => l.eventId)?.eventId;
    const event = eventId ? this.store.eventsById().get(eventId) : undefined;
    if (!event) return 'Timing';
    const heatNo = this.store.heatNoByPhysicalHeatId().get(this.heatId);
    return heatNo ? `${formatEventTitle(event)} · Heat ${heatNo}` : formatEventTitle(event);
  });

  readonly lanes = computed(() =>
    buildLaneRowViewModels(
      this.store.lanesByHeatId().get(this.heatId) ?? [],
      this.store.observationsByLaneId(),
      this.store.teamsById(),
      this.store.swimmersById(),
      this.auth.coach()?.id ?? null,
      this.laneSessions(),
      this.selectedLaneIds()
    )
  );

  constructor() {
    this.destroyRef.onDestroy(() => this.stopInterval());
    effect(() => {
      if (
        this.allLanesFinished() &&
        this.heatStatus() !== 'completed' &&
        !this.manualOverrideActive()
      ) {
        void this.store.autoUpdateHeatStatus(this.heatId, 'completed');
      }
    });
  }

  async ngOnInit(): Promise<void> {
    if (this.store.status() === 'idle') await this.store.load();
  }

  startAll(): void {
    if (this.heatRunning()) return;
    this.heatStartedAt = Date.now();
    this.heatElapsedMs.set(0);
    this.heatRunning.set(true);
    this.intervalId = setInterval(() => this.heatElapsedMs.set(Date.now() - this.heatStartedAt), 30);
    if (this.heatStatus() === 'pending') {
      void this.store.autoUpdateHeatStatus(this.heatId, 'in_progress');
    }
  }

  async markHeatComplete(): Promise<void> {
    this.manualOverrideActive.set(false);
    await this.store.setHeatStatusByScorer(
      this.heatId,
      'completed',
      this.auth.coach()?.id ?? null,
      'heat_force_completed'
    );
  }

  async reopenHeat(): Promise<void> {
    this.manualOverrideActive.set(true);
    await this.store.setHeatStatusByScorer(
      this.heatId,
      'in_progress',
      this.auth.coach()?.id ?? null,
      'heat_reopened'
    );
  }

  stopAll(): void {
    if (!this.heatRunning()) return;
    this.stopInterval();
    this.heatRunning.set(false);
  }

  lap(laneId: string): void {
    if (!this.captureEnabled()) return;
    this.updateSession(laneId, (s) => ({ ...s, splits: [...s.splits, this.heatElapsedMs()] }));
  }

  async finish(laneId: string): Promise<void> {
    if (!this.captureEnabled()) return;
    await this.finishLanes(this.heatElapsedMs(), 'stopwatch', [laneId]);
  }

  async finishManual(laneId: string, finalTimeMs: number): Promise<void> {
    await this.finishLanes(finalTimeMs, 'manual', [laneId]);
  }

  async undo(laneId: string): Promise<void> {
    const observationId = this.laneSessions().get(laneId)?.finishedObservationId;
    if (!observationId) return;
    await this.store.retractObservation(observationId);
    this.updateSession(laneId, () => emptyLaneSession());
  }

  toggleSelected(laneId: string): void {
    const next = new Set(this.selectedLaneIds());
    if (next.has(laneId)) next.delete(laneId);
    else next.add(laneId);
    this.selectedLaneIds.set(next);
  }

  async finishSelected(): Promise<void> {
    const laneIds = [...this.selectedLaneIds()];
    if (!laneIds.length) return;
    await this.finishLanes(this.heatElapsedMs(), 'stopwatch', laneIds);
    this.selectedLaneIds.set(new Set());
  }

  // Bulk finish intentionally drops any splits already logged for the selected lanes — a coach
  // reaching for multi-select is watching several simultaneous touches, not mid-race splits.
  private async finishLanes(
    finalTimeMs: number,
    source: 'stopwatch' | 'manual',
    laneIds: string[]
  ): Promise<void> {
    const coachId = this.auth.coach()?.id;
    if (!coachId) return;
    for (const laneId of laneIds) {
      const splits = source === 'stopwatch' ? (this.laneSessions().get(laneId)?.splits ?? []) : [];
      const observation = await this.store.recordObservation({
        physicalLaneId: laneId,
        coachId,
        finalTimeMs,
        source,
        splits: splits.map((splitMs, i) => ({ splitNo: i + 1, splitMs })),
      });
      this.updateSession(laneId, () => ({
        splits: [],
        finishedObservationId: observation.id,
        finishedFinalTimeMs: finalTimeMs,
      }));
    }
  }

  private updateSession(laneId: string, update: (current: LaneSession) => LaneSession): void {
    const current = this.laneSessions().get(laneId) ?? emptyLaneSession();
    const next = new Map(this.laneSessions());
    next.set(laneId, update(current));
    this.laneSessions.set(next);
  }

  private stopInterval(): void {
    if (this.intervalId == null) return;
    clearInterval(this.intervalId);
    this.intervalId = null;
  }
}
