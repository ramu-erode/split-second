import { Injectable, computed, inject, signal } from '@angular/core';
import { SupabaseService } from '../supabase/supabase.service';
import { mapCoach } from '../data/row-mappers';
import { Coach } from '../models/domain.models';
import { ACES_TEAM_ID } from '../constants';

export type AuthStatus = 'idle' | 'loading' | 'authenticated' | 'unauthenticated';

// Auth requires Supabase's "Confirm email" setting OFF for this project — signUp() below assumes
// a session is available immediately so it can create the coach row in the same flow. With email
// confirmation on, there's no session until the coach clicks the confirmation link, and the coach
// row never gets created.
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly supabase = inject(SupabaseService).client;

  private readonly _status = signal<AuthStatus>('idle');
  private readonly _coach = signal<Coach | null>(null);
  private readonly _error = signal<string | null>(null);

  readonly status = this._status.asReadonly();
  readonly coach = this._coach.asReadonly();
  readonly error = this._error.asReadonly();
  readonly isAuthenticated = computed(() => this._status() === 'authenticated');

  constructor() {
    this.supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) this.loadCoach(session.user.id);
      else {
        this._coach.set(null);
        this._status.set('unauthenticated');
      }
    });
  }

  async init(): Promise<void> {
    this._status.set('loading');
    const { data } = await this.supabase.auth.getSession();
    if (data.session?.user) await this.loadCoach(data.session.user.id);
    else this._status.set('unauthenticated');
  }

  async signUp(email: string, password: string, displayName: string): Promise<void> {
    this._error.set(null);
    const { data, error } = await this.supabase.auth.signUp({ email, password });
    if (error) return this.fail(error.message);
    if (!data.user) return this.fail('Sign up did not return a user.');
    const { error: coachError } = await this.supabase
      .from('coaches')
      .insert({ id: data.user.id, team_id: ACES_TEAM_ID, display_name: displayName, can_score: false });
    if (coachError) return this.fail(coachError.message);
    await this.loadCoach(data.user.id);
  }

  async logIn(email: string, password: string): Promise<void> {
    this._error.set(null);
    const { error } = await this.supabase.auth.signInWithPassword({ email, password });
    if (error) this.fail(error.message);
  }

  async logOut(): Promise<void> {
    await this.supabase.auth.signOut();
  }

  private async loadCoach(userId: string): Promise<void> {
    const res = await this.supabase.from('coaches').select('*').eq('id', userId).maybeSingle();
    if (!res.data) {
      // Supabase auth session exists but there's no matching coaches row (e.g. "Confirm email"
      // was on and the post-signup insert never ran). Treat as not logged in rather than letting
      // the guard through to a screen where every RLS-gated query silently returns nothing.
      this._coach.set(null);
      this._error.set('No coach profile found for this account. Contact your head coach.');
      this._status.set('unauthenticated');
      return;
    }
    this._coach.set(mapCoach(res.data));
    this._status.set('authenticated');
  }

  private fail(message: string): void {
    this._error.set(message);
    this._status.set('unauthenticated');
    throw new Error(message);
  }
}
