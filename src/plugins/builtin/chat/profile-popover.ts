import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  apiClient,
  type AccountProfile,
  type ChatUserSummary,
} from "../../../api-client";
import {
  PROFILE_POPOVER_CLOSE_DELAY_MS,
  hasPublicChatProfileInfo,
} from "./message/profile-popover";
import {
  consumePendingChatProfile,
  getPendingChatProfile,
  subscribeChatProfileSnapshot,
} from "./profile-request";

export {
  clearPendingChatProfile,
  requestOpenChatProfile,
} from "./profile-request";

function accountProfileToChatUser(profile: AccountProfile): ChatUserSummary {
  return {
    id: profile.id,
    username: profile.username,
    displayName: profile.name,
    bio: profile.bio,
    company: profile.company,
    title: profile.title,
    xAccount: profile.xAccount,
    profilePublic: profile.profilePublic,
    acceptUnknownDms: profile.acceptUnknownDms,
    portfolioAnalytics: profile.portfolioAnalytics,
  };
}

const OPTIONAL_PROFILE_FIELDS = [
  "company",
  "title",
  "bio",
  "publicEmail",
  "xAccount",
  "sharedPortfolioId",
] as const;

/** `profilePublic` is a visibility switch, not a completion test: any filled optional field counts as set up. */
export function isAccountProfileConfigured(profile: AccountProfile): boolean {
  return OPTIONAL_PROFILE_FIELDS.some((field) => (profile[field] ?? "").trim().length > 0);
}

export function useChatProfilePopover(currentUserId?: string | null) {
  const [profilePopoverUser, setProfilePopoverUser] = useState<ChatUserSummary | null>(null);
  const [profilePopoverPinned, setProfilePopoverPinned] = useState(false);
  const [ownProfileConfigured, setOwnProfileConfigured] = useState<boolean | null>(null);
  const profilePopoverCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ownProfileRef = useRef<ChatUserSummary | null>(null);
  const ownProfileRequestRef = useRef<Promise<void> | null>(null);
  const ownProfileLoadedAtRef = useRef(0);
  const activeRef = useRef(true);
  const pinnedRef = useRef(false);
  const pendingProfile = useSyncExternalStore(
    subscribeChatProfileSnapshot,
    getPendingChatProfile,
    getPendingChatProfile,
  );

  const cancelProfilePopoverClose = useCallback(() => {
    if (profilePopoverCloseTimerRef.current == null) return;
    clearTimeout(profilePopoverCloseTimerRef.current);
    profilePopoverCloseTimerRef.current = null;
  }, []);

  const closeProfilePopover = useCallback(() => {
    cancelProfilePopoverClose();
    pinnedRef.current = false;
    setProfilePopoverPinned(false);
    setProfilePopoverUser(null);
  }, [cancelProfilePopoverClose]);

  const scheduleProfilePopoverClose = useCallback(() => {
    if (pinnedRef.current) return;
    cancelProfilePopoverClose();
    profilePopoverCloseTimerRef.current = setTimeout(() => {
      profilePopoverCloseTimerRef.current = null;
      if (pinnedRef.current) return;
      setProfilePopoverUser(null);
    }, PROFILE_POPOVER_CLOSE_DELAY_MS);
  }, [cancelProfilePopoverClose]);

  const refreshOwnProfile = useCallback((expectedUserId?: string, force = false) => {
    if (
      !apiClient.getSessionToken()
      || ownProfileRequestRef.current
      || (
        !force
        && ownProfileRef.current
        && (!expectedUserId || ownProfileRef.current.id === expectedUserId)
        && Date.now() - ownProfileLoadedAtRef.current < 10_000
      )
    ) return;
    const request = apiClient.getAccountProfile()
      .then((profile) => {
        if (!activeRef.current || (expectedUserId && profile.id !== expectedUserId)) return;
        const nextUser = accountProfileToChatUser(profile);
        ownProfileRef.current = nextUser;
        ownProfileLoadedAtRef.current = Date.now();
        setOwnProfileConfigured(isAccountProfileConfigured(profile));
        setProfilePopoverUser((current) => current?.id === profile.id ? nextUser : current);
      })
      .catch(() => {})
      .finally(() => {
        if (ownProfileRequestRef.current === request) {
          ownProfileRequestRef.current = null;
        }
      });
    ownProfileRequestRef.current = request;
  }, []);

  const showProfilePopover = useCallback((
    targetUser: ChatUserSummary,
    options?: { ownProfile?: boolean; pin?: boolean },
  ) => {
    const ownProfile = options?.ownProfile === true;
    const pin = options?.pin === true;
    const cachedUser = ownProfile && ownProfileRef.current?.id === targetUser.id
      ? ownProfileRef.current
      : targetUser;
    if (!ownProfile && !pin && !hasPublicChatProfileInfo(cachedUser)) {
      if (!pinnedRef.current) closeProfilePopover();
      return;
    }
    cancelProfilePopoverClose();
    if (pin) {
      pinnedRef.current = true;
      setProfilePopoverPinned(true);
    }
    setProfilePopoverUser(cachedUser);
    if (ownProfile) refreshOwnProfile(targetUser.id);
  }, [cancelProfilePopoverClose, closeProfilePopover, refreshOwnProfile]);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      cancelProfilePopoverClose();
    };
  }, [cancelProfilePopoverClose]);

  // Force a refresh when the pane regains focus so returning from Account Management settles the answer.
  useEffect(() => {
    if (!currentUserId) return;
    if (ownProfileRef.current?.id !== currentUserId) setOwnProfileConfigured(null);
    refreshOwnProfile(currentUserId, true);
  }, [refreshOwnProfile, currentUserId]);

  useEffect(() => {
    if (!pendingProfile) return;
    showProfilePopover(pendingProfile, {
      pin: true,
      ownProfile: pendingProfile.id === currentUserId,
    });
    consumePendingChatProfile();
  }, [currentUserId, pendingProfile, showProfilePopover]);

  return {
    cancelProfilePopoverClose,
    closeProfilePopover,
    ownProfileConfigured,
    profilePopoverPinned,
    profilePopoverUser,
    scheduleProfilePopoverClose,
    showProfilePopover,
  };
}
