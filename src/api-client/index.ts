import type { TickerFinancials } from "../types/financials";
import type { InstrumentSearchResult } from "../types/instrument";
import { CloudAuthApi } from "./auth";
import { CloudChatApi } from "./chat";
import { CloudCollectionsApi } from "./collections";
import { CloudDataApi } from "./data";
import { ApiRequestError } from "./errors";
import { CloudNotesApi } from "./notes";
import { CloudApiRequestTransport } from "./request";
import { CloudApiSocket } from "./socket";
import { CloudTeamsApi } from "./teams";
import { CloudViewsApi } from "./views";
import type {
  CloudCdsParams,
  CloudCongressHouseParams,
  CloudEarningsCallsParams,
  CloudFredSeriesParams,
  CloudSearchParams,
  CloudSecFilingParams,
  CloudSecFilingsParams,
  CloudHistoryParams,
  CloudNewsParams,
  CloudTickerTweetsParams,
  CloudTweetSearchParams,
} from "./paths";
import { withDeadline } from "../utils/async-deadline";
import type {
  AssistCommandDescriptor,
  AssistCommandResponse,
  ChatMessage,
  ChatChannel,
  ChatChannelState,
  ChatNotification,
  ChatPresence,
  ChatStateResponse,
  AuthUser,
  PersistedAuthUser,
  AccountProfile,
  BuildoutAccountResponse,
  BuildoutTokenResponse,
  CloudPricing,
  AccountProfileUpdate,
  CloudQuotePayload,
  CloudOptionsChainPayload,
  CloudCompanyProfile,
  CloudFundamentals,
  CloudHoldersPayload,
  CloudAnalystResearchPayload,
  CloudShortInterestPayload,
  CloudBrowserHandoffResponse,
  CloudCorporateActionsPayload,
  CloudPricePointPayload,
  CloudEconEventPayload,
  CloudEquityDiagnosticMode,
  CloudEquityDiagnosticResult,
  CloudCdsResponse,
  CloudFredSeriesPayload,
  CloudShillerPayload,
  CloudYieldPointPayload,
  CloudCongressHousePayload,
  CloudEarningsCallListPayload,
  CloudEarningsTranscriptPayload,
  CloudProxyStatementListPayload,
  CloudProxyStatementPayload,
  CloudNewsPayload,
  CloudSavedSearch,
  CloudSavedSearchInput,
  CloudSearchDocType,
  CloudSearchDocument,
  CloudSearchDocumentResponse,
  CloudSearchHit,
  CloudSearchResponse,
  CloudSecContentResponse,
  CloudSecDocumentsResponse,
  CloudSecFilingsResponse,
  CloudNewsListResponse,
  CloudTweetSearchResponse,
  CloudMarketResponse,
  CloudMarketBatchTarget,
  CloudMarketBatchPayload,
  CloudMarketScreenerCategory,
  CloudMarketScreenerPayload,
  CloudWorldVenueMapPayload,
  CloudVerificationResponse,
  DeviceAuthStartResponse,
  DeviceAuthTokenResponse,
  CloudRoundupPreviewResponse,
  CloudSyncPushResponse,
  CloudSyncSnapshotResponse,
  QuoteStreamTarget,
  ScannerFeedEvent,
  ScannerKind,
} from "./types";
import type { SyncSettings, SyncSnapshot } from "../sync/types";
import {
  isMarketplaceLayoutId,
  parseMarketplaceLayoutEntry,
  parseMarketplaceLayoutList,
  type LayoutMarketplaceEntry,
  type LayoutMarketplacePayload,
} from "../layout-marketplace/payload";
import {
  type CloudLayoutEntry,
  type CloudLayoutVisibility,
  type LayoutRequirement,
  LayoutRevisionConflictError,
  parseCloudLayoutEntry,
  parseCloudLayoutList,
} from "../layout-marketplace/cloud";

export type * from "./types";
export { setCloudApiFetchTransport } from "./request";
export { emptyChatPresence, mergeChatPresence, normalizeChatPresence } from "./normalizers";
export { NoteConflictError } from "./notes";
export { TeamRevisionConflictError } from "./views";
export { LayoutRevisionConflictError } from "../layout-marketplace/cloud";
export { TEAM_ACCENT_COLORS } from "./types";

/** Server-side caps for `/assist/command`; enforced here so a 422 is never sent. */
const ASSIST_QUERY_MAX_LENGTH = 200;
const ASSIST_COMMAND_LIMIT = 150;
const ASSIST_REQUEST_TIMEOUT_MS = 6_000;

class GloomApiClient {
  private currentUser: AuthUser | null = null;
  private sessionChecked = false;
  /** Last few session transitions, content-free, for app://auth. */
  private authTrace: Array<{ at: number; event: string; token: boolean; user: string }> = [];
  private sessionRequest: Promise<AuthUser | null> | null = null;
  private readonly currentUserListeners = new Set<() => void>();
  private readonly transport = new CloudApiRequestTransport();
  private readonly auth: CloudAuthApi;
  private readonly socket: CloudApiSocket;
  private readonly chat: CloudChatApi;
  private readonly teams: CloudTeamsApi;
  private readonly data: CloudDataApi;
  private readonly notes: CloudNotesApi;
  private readonly collections: CloudCollectionsApi;
  private readonly views: CloudViewsApi;

  constructor() {
    this.auth = new CloudAuthApi({
      getCurrentUser: () => this.currentUser,
      getSessionToken: () => this.transport.getSessionToken(),
      hasSessionCredential: () => this.transport.hasSessionCredential(),
      request: (path, options) => this.request(path, options),
      requireCapturedSession: (message) => this.requireCapturedSession(message),
      setCurrentUser: (user) => this.setCurrentUser(user),
      setSessionToken: (token) => this.setSessionToken(token),
      updateCurrentUser: (updater) => this.updateCurrentUser(updater),
    });
    this.socket = new CloudApiSocket({
      getBaseUrl: () => this.transport.getSocketBaseUrl(),
      getSocketAuthToken: () => this.getSocketAuthToken(),
      getSocketAuthHeaders: () => this.transport.getSocketAuthHeaders(),
      hasSessionCredential: () => this.transport.hasSessionCredential(),
      hasVerifiedUser: () => this.currentUser?.emailVerified === true,
      isCookieAuthenticated: () => this.transport.isHostedSocket(),
      isUsingWebSocketToken: () => !!this.transport.getWebSocketToken(),
      clearWebSocketTokenForFallback: () => this.transport.clearWebSocketTokenForFallback(),
      markCurrentUserUnverified: () => {
        if (this.currentUser) {
          this.currentUser = { ...this.currentUser, emailVerified: false };
        }
      },
      updateCurrentUserFromSocket: (user) => {
        this.updateCurrentUser((currentUser) => ({
          ...currentUser,
          ...user,
        }));
      },
    });
    this.chat = new CloudChatApi({
      request: (path, options) => this.request(path, options),
      socket: this.socket,
    });
    this.teams = new CloudTeamsApi({
      request: (path, options) => this.request(path, options),
      socket: this.socket,
    });
    this.data = new CloudDataApi((path, options) => this.request(path, options));
    this.notes = new CloudNotesApi((path, options) => this.request(path, options));
    this.collections = new CloudCollectionsApi((path, options) => this.request(path, options));
    this.views = new CloudViewsApi((path, options) => this.request(path, options));
  }

  getSessionToken(): string | null {
    return this.transport.getSessionToken();
  }

  getWebSocketToken(): string | null {
    return this.transport.getWebSocketToken();
  }

  setCookieSessionMode(enabled: boolean): void {
    this.sessionChecked = false;
    this.transport.setCookieSessionMode(enabled);
  }

  setSessionToken(token: string | null): void {
    const changed = this.transport.getSessionToken() !== token;
    this.sessionChecked = false;
    this.transport.setSessionToken(token);
    this.traceAuth(changed ? "setSessionToken:changed" : "setSessionToken:same");
    if (!token) {
      this.currentUser = null;
      this.emitCurrentUserChange();
    }
    this.socket.syncAuthState({ reconnect: changed });
  }

  setWebSocketToken(token: string | null): void {
    const changed = this.transport.getWebSocketToken() !== token;
    this.transport.setWebSocketToken(token);
    this.socket.syncAuthState({ reconnect: changed });
  }

  /**
   * Point the realtime socket at the hosted Worker origin (e.g.
   * `https://terminal.kohor.st`) so it connects same-origin and authenticates
   * through the HttpOnly session cookie instead of a query-string token.
   */
  setHostedSocketBaseUrl(url: string | null): void {
    this.transport.setHostedSocketBaseUrl(url);
    this.socket.syncAuthState({ reconnect: true });
  }

  getCurrentUser(): AuthUser | null {
    return this.currentUser;
  }

  /**
   * Whether a signed-in session exists on this surface. Browser builds keep the
   * session in an HttpOnly cookie, so the raw token is deliberately null there
   * and the restored user is the only signal.
   */
  isSignedIn(): boolean {
    return !!this.transport.getSessionToken() || !!this.currentUser;
  }

  /** Notifies when the signed-in user changes, including plan and trial entitlement. */
  subscribeCurrentUser(listener: () => void): () => void {
    this.currentUserListeners.add(listener);
    return () => {
      this.currentUserListeners.delete(listener);
    };
  }

  restoreCachedUser(user: PersistedAuthUser | null): void {
    this.auth.restoreCachedUser(user);
  }

  isVerified(): boolean {
    return this.transport.hasSessionCredential() && !!this.currentUser?.emailVerified;
  }

  /**
   * What this client currently believes about its session, with no secrets.
   * Exposed over remote control so a "shows my username but not my
   * subscription" report can be answered from the running app instead of
   * from guesses about it.
   */
  describeAuthState(): {
    hasSessionCredential: boolean;
    hasSessionToken: boolean;
    sessionChecked: boolean;
    sessionRequestInFlight: boolean;
    trace: Array<{ at: number; event: string; token: boolean; user: string }>;
    currentUser: {
      id: string;
      emailVerified: boolean;
      plan: string | null;
      effectivePlan: string | null;
      trialEndsAt: string | null;
    } | null;
  } {
    const user = this.currentUser;
    return {
      hasSessionCredential: this.transport.hasSessionCredential(),
      hasSessionToken: !!this.transport.getSessionToken(),
      sessionChecked: this.sessionChecked,
      sessionRequestInFlight: !!this.sessionRequest,
      trace: [...this.authTrace],
      currentUser: user
        ? {
          id: user.id,
          emailVerified: user.emailVerified === true,
          plan: user.plan ?? null,
          effectivePlan: user.effectivePlan ?? null,
          trialEndsAt: user.trialEndsAt ?? null,
        }
        : null,
    };
  }

  private traceAuth(event: string, user: AuthUser | null = this.currentUser): void {
    this.authTrace.push({
      at: Date.now(),
      event,
      token: !!this.transport.getSessionToken(),
      user: user ? (user.emailVerified ? "verified" : "unverified") : "none",
    });
    if (this.authTrace.length > 24) this.authTrace.shift();
  }

  private setCurrentUser(user: AuthUser | null): void {
    const changed = this.socketEntitlementKey(this.currentUser) !== this.socketEntitlementKey(user);
    this.traceAuth("setCurrentUser", user);
    this.currentUser = user;
    this.socket.syncAuthState({ reconnect: changed });
    this.emitCurrentUserChange();
  }

  private emitCurrentUserChange(): void {
    for (const listener of this.currentUserListeners) listener();
  }

  private updateCurrentUser(updater: (user: AuthUser) => AuthUser): void {
    if (!this.currentUser) return;
    this.setCurrentUser(updater(this.currentUser));
  }

  private socketEntitlementKey(user: AuthUser | null): string {
    if (!user) return "anonymous";
    return [
      user.id,
      user.emailVerified === true ? "verified" : "unverified",
      user.plan,
      // A trial starting or lapsing changes the stream entitlement without touching `plan`.
      user.effectivePlan,
    ].join(":");
  }

  private requireCapturedSession(message: string): void {
    if (this.transport.hasSessionCredential()) return;
    this.transport.setWebSocketToken(null);
    this.setCurrentUser(null);
    throw new Error(message);
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    return this.transport.request<T>(path, options);
  }

  private getSocketAuthToken(): string | null {
    return this.transport.getSocketAuthToken();
  }

  async ensureVerifiedSession(): Promise<AuthUser | null> {
    if (!this.transport.hasSessionCredential()) return null;
    if (!this.currentUser && !this.sessionChecked) await this.getSession();
    return this.currentUser?.emailVerified ? this.currentUser : null;
  }

  async signUp(email: string, username: string, name: string, password: string): Promise<AuthUser> {
    return this.auth.signUp(email, username, name, password);
  }

  async signIn(email: string, password: string): Promise<AuthUser> {
    return this.auth.signIn(email, password);
  }

  async startDeviceSignIn(body: { clientName?: string; clientPlatform?: string }): Promise<DeviceAuthStartResponse> {
    return this.auth.startDeviceSignIn(body);
  }

  async pollDeviceSignIn(deviceCode: string): Promise<DeviceAuthTokenResponse> {
    return this.auth.pollDeviceSignIn(deviceCode);
  }

  async signOut(): Promise<void> {
    return this.auth.signOut();
  }

  async getSession(): Promise<AuthUser | null> {
    if (this.sessionRequest) {
      this.traceAuth("getSession:joined-inflight");
      return this.sessionRequest;
    }
    this.traceAuth("getSession:start");
    this.sessionRequest = this.auth.getSession();
    try {
      const user = await this.sessionRequest;
      this.sessionChecked = true;
      this.traceAuth("getSession:done", user);
      return user;
    } catch (error) {
      this.traceAuth(`getSession:error:${error instanceof Error ? error.message.slice(0, 60) : "unknown"}`);
      throw error;
    } finally {
      this.sessionRequest = null;
    }
  }

  async sendVerification(): Promise<CloudVerificationResponse> {
    return this.auth.sendVerification();
  }

  async requestPasswordReset(email: string): Promise<void> {
    return this.auth.requestPasswordReset(email);
  }

  async createBrowserHandoff(): Promise<CloudBrowserHandoffResponse> {
    return this.auth.createBrowserHandoff();
  }

  /** Creates a Stripe checkout session for Cloud Pro; the URL opens in a browser. */
  async createCloudCheckout(): Promise<{ url: string }> {
    return this.request<{ url: string }>("/stripe/checkout", { method: "POST", body: JSON.stringify({}) });
  }

  /** Stores a verified user's public terminal snapshot or pane handoff. */
  async createTerminalShare(payload: unknown): Promise<{ id: string; expiresAt: string }> {
    return this.request<{ id: string; expiresAt: string }>("/shares", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  /** Stripe billing portal for an account that already has a subscription. */
  async createBillingPortal(): Promise<{ url: string }> {
    return this.request<{ url: string }>("/stripe/portal", { method: "POST", body: JSON.stringify({}) });
  }

  async getAccountProfile(): Promise<AccountProfile> {
    return this.auth.getAccountProfile();
  }

  async getCloudPricing(): Promise<CloudPricing> {
    return this.auth.getCloudPricing();
  }

  async getBuildoutAccount(): Promise<BuildoutAccountResponse> {
    return this.auth.getBuildoutAccount();
  }

  async getBuildoutToken(): Promise<BuildoutTokenResponse> {
    return this.auth.getBuildoutToken();
  }

  async updateAccountProfile(update: AccountProfileUpdate): Promise<AccountProfile> {
    return this.auth.updateAccountProfile(update);
  }

  async getSyncSnapshot(): Promise<CloudSyncSnapshotResponse> {
    return this.request<CloudSyncSnapshotResponse>("/sync/snapshot", { method: "GET" });
  }

  async putSyncSnapshot(snapshot: SyncSnapshot, options?: { baseRevision?: number | null }): Promise<CloudSyncPushResponse> {
    return this.request<CloudSyncPushResponse>("/sync/snapshot", {
      method: "PUT",
      body: JSON.stringify({
        snapshot,
        baseRevision: options?.baseRevision ?? null,
      }),
    });
  }

  async getMarketplaceLayout(
    id: string,
    options?: { signal?: AbortSignal },
  ): Promise<LayoutMarketplaceEntry | null> {
    if (!isMarketplaceLayoutId(id)) return null;
    try {
      return parseMarketplaceLayoutEntry(await this.request<unknown>(`/layouts/${encodeURIComponent(id)}`, {
        method: "GET",
        signal: options?.signal,
      }));
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) return null;
      throw error;
    }
  }

  async listMarketplaceLayouts(options?: { signal?: AbortSignal }): Promise<LayoutMarketplaceEntry[]> {
    const items = parseMarketplaceLayoutList(await this.request<unknown>("/layouts", {
      method: "GET",
      signal: options?.signal,
    }));
    if (!items) throw new Error("The layout marketplace returned invalid data.");
    return items;
  }

  async publishMarketplaceLayout(
    name: string,
    payload: LayoutMarketplacePayload,
    options?: { signal?: AbortSignal },
  ): Promise<LayoutMarketplaceEntry> {
    const item = parseMarketplaceLayoutEntry(await this.request<unknown>("/layouts", {
      method: "POST",
      body: JSON.stringify({ name: name.trim(), ...payload }),
      signal: options?.signal,
    }));
    if (!item) throw new Error("The layout marketplace returned invalid data.");
    return item;
  }

  async getCloudLayout(id: string, options?: { signal?: AbortSignal }): Promise<CloudLayoutEntry | null> {
    if (!isMarketplaceLayoutId(id)) return null;
    try {
      return parseCloudLayoutEntry(await this.request<unknown>(`/layouts/${encodeURIComponent(id)}?v=2`, {
        method: "GET",
        signal: options?.signal,
      }));
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) return null;
      throw error;
    }
  }

  async listTeamLayouts(teamId: string, options?: { signal?: AbortSignal }): Promise<CloudLayoutEntry[]> {
    const items = parseCloudLayoutList(await this.request<unknown>(`/teams/${encodeURIComponent(teamId)}/layouts`, {
      method: "GET",
      signal: options?.signal,
    }));
    if (!items) throw new Error("The layout service returned invalid data.");
    return items;
  }

  async publishTeamLayout(
    teamId: string,
    name: string,
    payload: LayoutMarketplacePayload,
    options: { requires?: LayoutRequirement[]; note?: string | null; visibility?: "team" | "public" } = {},
  ): Promise<CloudLayoutEntry> {
    const item = parseCloudLayoutEntry(await this.request<unknown>(`/teams/${encodeURIComponent(teamId)}/layouts`, {
      method: "POST",
      body: JSON.stringify({
        name: name.trim(),
        ...payload,
        requires: options.requires ?? [],
        ...(options.note ? { note: options.note } : {}),
        ...(options.visibility ? { visibility: options.visibility } : {}),
      }),
    }));
    if (!item) throw new Error("The layout service returned invalid data.");
    return item;
  }

  async publishLayoutRevision(
    id: string,
    payload: LayoutMarketplacePayload,
    options: { expectedRevision?: number; requires?: LayoutRequirement[]; note?: string | null; name?: string } = {},
  ): Promise<CloudLayoutEntry> {
    try {
      const item = parseCloudLayoutEntry(await this.request<unknown>(`/layouts/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: options.expectedRevision ? { "if-match": String(options.expectedRevision) } : {},
        body: JSON.stringify({
          ...payload,
          requires: options.requires ?? [],
          ...(options.note ? { note: options.note } : {}),
          ...(options.name ? { name: options.name } : {}),
        }),
      }));
      if (!item) throw new Error("The layout service returned invalid data.");
      return item;
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 412) {
        const current = await this.getCloudLayout(id).catch(() => null);
        throw new LayoutRevisionConflictError(error.message, current?.revision ?? (options.expectedRevision ?? 0) + 1);
      }
      throw error;
    }
  }

  async updateCloudLayout(
    id: string,
    patch: { name?: string; visibility?: CloudLayoutVisibility },
  ): Promise<CloudLayoutEntry> {
    const item = parseCloudLayoutEntry(await this.request<unknown>(`/layouts/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }));
    if (!item) throw new Error("The layout service returned invalid data.");
    return item;
  }

  async updateSyncSettings(update: Partial<SyncSettings>): Promise<SyncSettings> {
    const result = await this.request<{ settings: SyncSettings }>("/sync/settings", {
      method: "PATCH",
      body: JSON.stringify(update),
    });
    if (this.currentUser) {
      this.currentUser = {
        ...this.currentUser,
        syncEnabled: result.settings.syncEnabled,
        weeklyRoundupEnabled: result.settings.weeklyRoundupEnabled,
        positionAlertsEnabled: result.settings.positionAlertsEnabled,
        lastSyncAt: result.settings.lastSyncAt ?? this.currentUser.lastSyncAt,
        lastRoundupEmailAt: result.settings.lastRoundupEmailAt ?? this.currentUser.lastRoundupEmailAt,
      };
    }
    return result.settings;
  }

  async getRoundupPreview(): Promise<CloudRoundupPreviewResponse> {
    return this.request<CloudRoundupPreviewResponse>("/sync/roundup/preview", { method: "POST", body: JSON.stringify({}) });
  }

  async sendRoundupTestEmail(): Promise<CloudRoundupPreviewResponse> {
    return this.request<CloudRoundupPreviewResponse>("/sync/roundup/test-email", { method: "POST", body: JSON.stringify({}) });
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    return this.auth.changePassword(currentPassword, newPassword);
  }

  async deleteAccount(): Promise<void> {
    return this.auth.deleteAccount();
  }

  /**
   * Resolves a natural-language command-bar query into runnable command-bar
   * inputs. Requires a verified session; free accounts are included. The
   * request is bounded client-side so a stalled upstream cannot hold the
   * command bar in its loading state.
   */
  async assistCommand(
    query: string,
    commands: AssistCommandDescriptor[],
    options?: { signal?: AbortSignal },
  ): Promise<AssistCommandResponse> {
    const controller = new AbortController();
    const callerSignal = options?.signal;
    const abortFromCaller = () => controller.abort(callerSignal?.reason);
    if (callerSignal?.aborted) {
      abortFromCaller();
    } else {
      callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
    }

    try {
      const request = this.request<AssistCommandResponse>("/assist/command", {
        method: "POST",
        body: JSON.stringify({
          query: query.trim().slice(0, ASSIST_QUERY_MAX_LENGTH),
          commands: commands.slice(0, ASSIST_COMMAND_LIMIT),
        }),
        signal: controller.signal,
      });
      return await withDeadline(
        request,
        ASSIST_REQUEST_TIMEOUT_MS,
        `Assist request timed out after ${ASSIST_REQUEST_TIMEOUT_MS}ms`,
        (error) => controller.abort(error),
      );
    } finally {
      callerSignal?.removeEventListener("abort", abortFromCaller);
    }
  }

  async getChannels(): Promise<ChatChannel[]> {
    return this.chat.getChannels();
  }

  async getChatPresence(): Promise<ChatPresence> {
    return this.chat.getPresence();
  }

  async getChatState(): Promise<ChatStateResponse> {
    return this.chat.getState();
  }

  async updateChatChannelState(
    channelId: string,
    body: { notificationsEnabled?: boolean; readThroughMessageId?: string },
  ): Promise<ChatChannelState> {
    return this.chat.updateChannelState(channelId, body);
  }

  async markChatNotificationsDelivered(notificationIds: string[]): Promise<{ delivered: number }> {
    return this.chat.markNotificationsDelivered(notificationIds);
  }

  async openDirectChannel(target: { userId?: string; username?: string }): Promise<ChatChannel> {
    return this.chat.openDirectChannel(target);
  }

  async openGroupChannel(body: { userIds?: string[]; usernames?: string[]; name?: string }): Promise<ChatChannel> {
    return this.chat.openGroupChannel(body);
  }

  async getMessages(
    channelId: string,
    opts?: { after?: string; before?: string; limit?: number },
  ): Promise<ChatMessage[]> {
    return this.chat.getMessages(channelId, opts);
  }

  async sendMessage(channelId: string, content: string, replyToId?: string, clientMessageId?: string): Promise<ChatMessage> {
    return this.chat.sendMessage(channelId, content, replyToId, clientMessageId);
  }

  async editMessage(channelId: string, messageId: string, content: string): Promise<ChatMessage> {
    return this.chat.editMessage(channelId, messageId, content);
  }

  connectChannel(
    channelId: string,
    onMessage: (msg: ChatMessage) => void,
    onError?: (err: string) => void,
  ): { send: (content: string, replyToId?: string, clientMessageId?: string) => Promise<ChatMessage>; close: () => void } {
    return this.chat.connectChannel(channelId, onMessage, onError);
  }

  subscribeChatNotifications(listener: (notification: ChatNotification) => void): () => void {
    return this.chat.subscribeNotifications(listener);
  }

  subscribeChatPresence(listener: (presence: ChatPresence) => void): () => void {
    return this.chat.subscribePresence(listener);
  }

  async listTeams() {
    return this.teams.listTeams();
  }
  async createTeam(input: Parameters<CloudTeamsApi["createTeam"]>[0]) {
    return this.teams.createTeam(input);
  }
  async getTeamMembers(teamId: string) {
    return this.teams.getTeamMembers(teamId);
  }
  async inviteTeamMemberByUsername(teamId: string, username: string) {
    return this.teams.inviteTeamMemberByUsername(teamId, username);
  }
  async listTeamInviteLinks(teamId: string) {
    return this.teams.listTeamInviteLinks(teamId);
  }
  async createTeamInviteLink(teamId: string, options?: Parameters<CloudTeamsApi["createTeamInviteLink"]>[1]) {
    return this.teams.createTeamInviteLink(teamId, options);
  }
  async deleteTeamInviteLink(teamId: string, token: string) {
    return this.teams.deleteTeamInviteLink(teamId, token);
  }
  async previewTeamInviteLink(token: string) {
    return this.teams.previewTeamInviteLink(token);
  }
  async joinTeamThroughLink(token: string) {
    return this.teams.joinTeamThroughLink(token);
  }
  async getTeamNotifications() {
    return this.teams.getTeamNotifications();
  }
  async listTeamInvitations(teamId: string) {
    return this.teams.listTeamInvitations(teamId);
  }
  async listMyTeamInvitations() {
    return this.teams.listMyTeamInvitations();
  }
  async acceptTeamInvitation(invitationId: string) {
    return this.teams.acceptTeamInvitation(invitationId);
  }
  async rejectTeamInvitation(invitationId: string) {
    return this.teams.rejectTeamInvitation(invitationId);
  }
  async cancelTeamInvitation(teamId: string, invitationId: string) {
    return this.teams.cancelTeamInvitation(teamId, invitationId);
  }
  async updateTeam(teamId: string, data: Parameters<CloudTeamsApi["updateTeam"]>[1]) {
    return this.teams.updateTeam(teamId, data);
  }
  async updateTeamMemberRole(teamId: string, memberId: string, role: Parameters<CloudTeamsApi["updateTeamMemberRole"]>[2]) {
    return this.teams.updateTeamMemberRole(teamId, memberId, role);
  }
  async removeTeamMember(teamId: string, memberId: string) {
    return this.teams.removeTeamMember(teamId, memberId);
  }
  async leaveTeam(teamId: string) {
    return this.teams.leaveTeam(teamId);
  }
  async deleteTeam(teamId: string) {
    return this.teams.deleteTeam(teamId);
  }
  async listTeamChannels(teamId: string) {
    return this.teams.listTeamChannels(teamId);
  }
  async createTeamChannel(teamId: string, name: string) {
    return this.teams.createTeamChannel(teamId, name);
  }
  async deleteTeamChannel(teamId: string, channelId: string) {
    return this.teams.deleteTeamChannel(teamId, channelId);
  }
  subscribeTeamUpdates(listener: Parameters<CloudTeamsApi["subscribeTeamUpdates"]>[0]) {
    return this.teams.subscribeTeamUpdates(listener);
  }
  subscribeTeamNotifications(listener: Parameters<CloudTeamsApi["subscribeTeamNotifications"]>[0]) {
    return this.teams.subscribeTeamNotifications(listener);
  }
  subscribeCloudEvent(type: string, listener: Parameters<CloudTeamsApi["subscribeCloudEvent"]>[1]) {
    return this.teams.subscribeCloudEvent(type, listener);
  }
  async listCloudNotes(scope: Parameters<CloudNotesApi["listNotes"]>[0]) {
    return this.notes.listNotes(scope);
  }
  async getCloudNote(id: string) {
    return this.notes.getNote(id);
  }
  async putCloudNote(input: Parameters<CloudNotesApi["putNote"]>[0]) {
    return this.notes.putNote(input);
  }
  async deleteCloudNote(id: string) {
    return this.notes.deleteNote(id);
  }
  async listTeamCollections(teamId: string) {
    return this.collections.listTeamCollections(teamId);
  }
  async getTeamCollection(teamId: string, collectionId: string) {
    return this.collections.getTeamCollection(teamId, collectionId);
  }
  async createTeamCollection(teamId: string, input: Parameters<CloudCollectionsApi["createTeamCollection"]>[1]) {
    return this.collections.createTeamCollection(teamId, input);
  }
  async updateTeamCollection(teamId: string, collectionId: string, patch: Parameters<CloudCollectionsApi["updateTeamCollection"]>[2]) {
    return this.collections.updateTeamCollection(teamId, collectionId, patch);
  }
  async deleteTeamCollection(teamId: string, collectionId: string) {
    return this.collections.deleteTeamCollection(teamId, collectionId);
  }
  async putTeamCollectionItem(
    teamId: string,
    collectionId: string,
    item: Parameters<CloudCollectionsApi["putTeamCollectionItem"]>[2],
  ) {
    return this.collections.putTeamCollectionItem(teamId, collectionId, item);
  }
  async removeTeamCollectionItem(teamId: string, collectionId: string, symbol: string, exchange = "") {
    return this.collections.removeTeamCollectionItem(teamId, collectionId, symbol, exchange);
  }
  async listTeamViews(teamId: string) {
    return this.views.listTeamViews(teamId);
  }
  async getTeamView(viewId: string) {
    return this.views.getTeamView(viewId);
  }
  async createTeamView(teamId: string, input: Parameters<CloudViewsApi["createTeamView"]>[1]) {
    return this.views.createTeamView(teamId, input);
  }
  async publishTeamViewRevision(viewId: string, input: Parameters<CloudViewsApi["publishTeamViewRevision"]>[1]) {
    return this.views.publishTeamViewRevision(viewId, input);
  }
  async renameTeamView(viewId: string, name: string) {
    return this.views.renameTeamView(viewId, name);
  }
  async deleteTeamView(viewId: string) {
    return this.views.deleteTeamView(viewId);
  }
  async listTeamPluginState(teamId: string, pluginId: string) {
    return this.views.listTeamPluginState(teamId, pluginId);
  }
  async getTeamPluginState(teamId: string, pluginId: string, key: string) {
    return this.views.getTeamPluginState(teamId, pluginId, key);
  }
  async putTeamPluginState(
    teamId: string,
    pluginId: string,
    key: string,
    value: unknown,
    expectedRevision?: number,
  ) {
    return this.views.putTeamPluginState(teamId, pluginId, key, value, expectedRevision);
  }
  async deleteTeamPluginState(teamId: string, pluginId: string, key: string) {
    return this.views.deleteTeamPluginState(teamId, pluginId, key);
  }

  subscribeQuotes(
    targets: QuoteStreamTarget[],
    onQuote: (target: QuoteStreamTarget, quote: CloudQuotePayload) => void,
  ): () => void {
    return this.socket.subscribeQuotes(targets, onQuote);
  }

  /** Subscribes to a shared scanner feed; all panes of one kind share one upstream subscription. */
  subscribeScanner(scanner: ScannerKind, listener: (event: ScannerFeedEvent) => void): () => void {
    return this.socket.subscribeScanner(scanner, listener);
  }

  dispose(): void {
    this.socket.dispose();
  }

  async searchInstruments(query: string, limit = 10): Promise<InstrumentSearchResult[]> {
    return this.data.searchInstruments(query, limit);
  }

  async getCloudQuote(symbol: string, exchange?: string): Promise<CloudMarketResponse<CloudQuotePayload>> {
    return this.data.getCloudQuote(symbol, exchange);
  }

  async getCloudQuotesBatch(
    targets: CloudMarketBatchTarget[],
    mode: "cache-first" | "refresh" = "cache-first",
  ): Promise<CloudMarketResponse<CloudMarketBatchPayload<CloudQuotePayload>>> {
    return this.data.getCloudQuotesBatch(targets, mode);
  }

  async getCloudWorldVenues(): Promise<CloudMarketResponse<CloudWorldVenueMapPayload>> {
    return this.data.getCloudWorldVenues();
  }

  async getCloudMarketScreener(
    category: CloudMarketScreenerCategory,
    count = 25,
    mode: "cache-first" | "refresh" = "cache-first",
  ): Promise<CloudMarketResponse<CloudMarketScreenerPayload>> {
    return this.data.getCloudMarketScreener(category, count, mode);
  }

  async getCloudOptionsChain(
    symbol: string,
    exchange?: string,
    expirationDate?: number,
  ): Promise<CloudMarketResponse<CloudOptionsChainPayload>> {
    return this.data.getCloudOptionsChain(symbol, exchange, expirationDate);
  }

  async getCloudProfile(symbol: string, exchange?: string): Promise<CloudMarketResponse<CloudCompanyProfile>> {
    return this.data.getCloudProfile(symbol, exchange);
  }

  async getCloudFundamentals(symbol: string, exchange?: string): Promise<CloudMarketResponse<CloudFundamentals>> {
    return this.data.getCloudFundamentals(symbol, exchange);
  }

  async getCloudFinancials(symbol: string, exchange?: string): Promise<CloudMarketResponse<TickerFinancials>> {
    return this.data.getCloudFinancials(symbol, exchange);
  }

  async getCloudFinancialsBatch(
    targets: CloudMarketBatchTarget[],
    mode: "cache-first" | "refresh" = "cache-first",
  ): Promise<CloudMarketResponse<CloudMarketBatchPayload<TickerFinancials>>> {
    return this.data.getCloudFinancialsBatch(targets, mode);
  }

  async getCloudHolders(symbol: string, exchange?: string): Promise<CloudMarketResponse<CloudHoldersPayload>> {
    return this.data.getCloudHolders(symbol, exchange);
  }

  async getCloudShortInterest(symbol: string, years?: number): Promise<CloudMarketResponse<CloudShortInterestPayload>> {
    return this.data.getCloudShortInterest(symbol, years);
  }

  async getCloudAnalystResearch(symbol: string, exchange?: string): Promise<CloudMarketResponse<CloudAnalystResearchPayload>> {
    return this.data.getCloudAnalystResearch(symbol, exchange);
  }

  async getCloudCorporateActions(symbol: string, exchange?: string): Promise<CloudMarketResponse<CloudCorporateActionsPayload>> {
    return this.data.getCloudCorporateActions(symbol, exchange);
  }

  async getCloudStatements(
    symbol: string,
    exchange?: string,
    period: "annual" | "quarterly" | "both" = "both",
  ): Promise<CloudMarketResponse<Pick<TickerFinancials, "annualStatements" | "quarterlyStatements">>> {
    return this.data.getCloudStatements(symbol, exchange, period);
  }

  async getCloudHistory(
    symbol: string,
    exchange: string,
    params: CloudHistoryParams = {},
  ): Promise<CloudMarketResponse<CloudPricePointPayload[]>> {
    return this.data.getCloudHistory(symbol, exchange, params);
  }

  async getCloudExchangeRate(fromCurrency: string): Promise<CloudMarketResponse<{ rate: number }>> {
    return this.data.getCloudExchangeRate(fromCurrency);
  }

  async getCloudEquityDiagnostic(
    symbol: string,
    exchange?: string,
    mode: CloudEquityDiagnosticMode = "cache-first",
  ): Promise<CloudEquityDiagnosticResult> {
    return this.data.getCloudEquityDiagnostic(symbol, exchange, mode);
  }

  async getCloudEconomicCalendar(): Promise<CloudEconEventPayload[]> {
    return this.data.getCloudEconomicCalendar();
  }

  async getCloudFredSeries(
    seriesId: string,
    params: CloudFredSeriesParams = {},
  ): Promise<CloudFredSeriesPayload> {
    return this.data.getCloudFredSeries(seriesId, params);
  }

  async getCloudShiller(): Promise<CloudShillerPayload> {
    return this.data.getCloudShiller();
  }

  async getCloudYieldCurve(): Promise<CloudYieldPointPayload[]> {
    return this.data.getCloudYieldCurve();
  }

  async getCloudCds(params: CloudCdsParams = {}): Promise<CloudCdsResponse> {
    return this.data.getCloudCds(params);
  }

  async getCloudCongressHouse(params: CloudCongressHouseParams = {}): Promise<CloudCongressHousePayload> {
    return this.data.getCloudCongressHouse(params);
  }

  async getCloudEarningsCalls(
    params: CloudEarningsCallsParams = {},
  ): Promise<CloudEarningsCallListPayload> {
    return this.data.getCloudEarningsCalls(params);
  }

  async getCloudEarningsTranscript(id: string): Promise<CloudEarningsTranscriptPayload> {
    return this.data.getCloudEarningsTranscript(id);
  }

  async getProxyStatements(ticker: string): Promise<CloudProxyStatementListPayload> {
    return this.data.getProxyStatements(ticker);
  }

  async getProxyStatement(ticker: string, year: number): Promise<CloudProxyStatementPayload> {
    return this.data.getProxyStatement(ticker, year);
  }

  async getCloudSecFilings(params: CloudSecFilingsParams): Promise<CloudSecFilingsResponse> {
    return this.data.getCloudSecFilings(params);
  }

  async getCloudSecFilingDocuments(params: CloudSecFilingParams): Promise<CloudSecDocumentsResponse> {
    return this.data.getCloudSecFilingDocuments(params);
  }

  async getCloudSecFilingContent(params: CloudSecFilingParams): Promise<CloudSecContentResponse> {
    return this.data.getCloudSecFilingContent(params);
  }

  async getCloudSec13F(path: string, params: Record<string, string | number | undefined> = {}): Promise<unknown> {
    return this.data.getCloudSec13F(path, params);
  }

  async searchCloudDocuments(
    params: CloudSearchParams,
    options?: { signal?: AbortSignal },
  ): Promise<CloudSearchResponse> {
    return this.data.searchCloudDocuments(params, options);
  }

  async getCloudSearchDocument(
    docType: CloudSearchDocType,
    sourceId: string,
    options?: { signal?: AbortSignal },
  ): Promise<CloudSearchDocument> {
    return this.data.getCloudSearchDocument(docType, sourceId, options);
  }

  async getCloudSavedSearches(options?: { signal?: AbortSignal }): Promise<CloudSavedSearch[]> {
    return this.data.getCloudSavedSearches(options);
  }

  async createCloudSavedSearch(input: CloudSavedSearchInput): Promise<CloudSavedSearch> {
    return this.data.createCloudSavedSearch(input);
  }

  async updateCloudSavedSearch(
    id: string,
    update: Partial<CloudSavedSearchInput>,
  ): Promise<CloudSavedSearch> {
    return this.data.updateCloudSavedSearch(id, update);
  }

  async deleteCloudSavedSearch(id: string): Promise<void> {
    return this.data.deleteCloudSavedSearch(id);
  }

  async getCloudSavedSearchHits(
    id: string,
    options?: { signal?: AbortSignal },
  ): Promise<CloudSearchHit[]> {
    return this.data.getCloudSavedSearchHits(id, options);
  }

  async getCloudNews(params: CloudNewsParams = {}): Promise<CloudNewsListResponse> {
    return this.data.getCloudNews(params);
  }

  async getCloudNewsStory(storyId: string): Promise<CloudNewsPayload> {
    return this.data.getCloudNewsStory(storyId);
  }

  async getCloudTickerTweets(params: CloudTickerTweetsParams): Promise<CloudTweetSearchResponse> {
    return this.data.getCloudTickerTweets(params);
  }

  async searchCloudTweets(params: CloudTweetSearchParams): Promise<CloudTweetSearchResponse> {
    return this.data.searchCloudTweets(params);
  }
}

export const apiClient = new GloomApiClient();
