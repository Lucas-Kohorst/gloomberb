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

export function useChatProfilePopover(currentUserId?: string | null) {
  const [profilePopoverUser, setProfilePopoverUser] = useState<ChatUserSummary | null>(null);
  const [profilePopoverPinned, setProfilePopoverPinned] = useState(false);
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

    if (
      !ownProfile
      || !apiClient.getSessionToken()
      || ownProfileRequestRef.current
      || (ownProfileRef.current?.id === targetUser.id && Date.now() - ownProfileLoadedAtRef.current < 10_000)
    ) return;
    const request = apiClient.getAccountProfile()
      .then((profile) => {
        if (!activeRef.current || profile.id !== targetUser.id) return;
        const nextUser = accountProfileToChatUser(profile);
        ownProfileRef.current = nextUser;
        ownProfileLoadedAtRef.current = Date.now();
        setProfilePopoverUser((current) => current?.id === targetUser.id ? nextUser : current);
      })
      .catch(() => {})
      .finally(() => {
        if (ownProfileRequestRef.current === request) {
          ownProfileRequestRef.current = null;
        }
      });
    ownProfileRequestRef.current = request;
  }, [cancelProfilePopoverClose, closeProfilePopover]);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      cancelProfilePopoverClose();
    };
  }, [cancelProfilePopoverClose]);

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
    profilePopoverPinned,
    profilePopoverUser,
    scheduleProfilePopoverClose,
    showProfilePopover,
  };
}
