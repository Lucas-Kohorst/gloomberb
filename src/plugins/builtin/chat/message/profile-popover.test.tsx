import { afterEach, describe, expect, test } from "bun:test";
import { act, useEffect } from "react";
import {
  apiClient,
  type AccountProfile,
  type ChatUserSummary,
} from "../../../../api-client";
import { testRender } from "../../../../renderers/opentui/test-utils";
import { Box, Text } from "../../../../ui";
import { useChatProfilePopover } from "../profile-popover";
import { requestOpenChatProfile } from "../profile-request";
import {
  hasPublicChatProfileInfo,
  shouldOfferChatProfileSetup,
  UserProfilePopover,
} from "./profile-popover";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;
const originalGetAccountProfile = apiClient.getAccountProfile.bind(apiClient);

afterEach(async () => {
  apiClient.getAccountProfile = originalGetAccountProfile;
  apiClient.setSessionToken(null);
  if (!testSetup) return;
  await act(async () => {
    testSetup?.renderer.destroy();
  });
  testSetup = undefined;
});

function makeUser(overrides: Partial<ChatUserSummary>): ChatUserSummary {
  return {
    id: "u1",
    username: "vince",
    displayName: "Vince",
    profilePublic: true,
    ...overrides,
  };
}

function makeAccountProfile(overrides: Partial<AccountProfile> = {}): AccountProfile {
  return {
    id: "u1",
    email: "vince@example.com",
    emailVerified: true,
    plan: "pro",
    username: "vince",
    name: "Vince",
    company: "Gloom",
    title: null,
    bio: "Made Gloomberb",
    profilePublic: true,
    publicEmail: null,
    xAccount: null,
    sharedPortfolioId: "broker:ibkr:coldstart",
    acceptUnknownDms: false,
    chatEmailNotificationsEnabled: true,
    portfolioAnalytics: null,
    syncEnabled: true,
    weeklyRoundupEnabled: true,
    positionAlertsEnabled: true,
    lastSyncAt: null,
    lastRoundupEmailAt: null,
    updatedAt: "2026-07-21T22:03:59.832Z",
    ...overrides,
  };
}

function RequestedProfileHarness() {
  const { profilePopoverUser } = useChatProfilePopover();
  return (
    <Box width={50} height={1}>
      <Text>{profilePopoverUser ? `@${profilePopoverUser.username}` : "none"}</Text>
    </Box>
  );
}

function PinnedProfileHarness({ user }: { user: ChatUserSummary }) {
  const {
    closeProfilePopover,
    profilePopoverUser,
    showProfilePopover,
  } = useChatProfilePopover();

  useEffect(() => {
    showProfilePopover(user, { pin: true });
  }, [showProfilePopover, user]);

  if (!profilePopoverUser) {
    return (
      <Box width={50} height={8}>
        <Text>none</Text>
      </Box>
    );
  }

  return (
    <Box width={50} height={8}>
      <UserProfilePopover
        user={profilePopoverUser}
        width={50}
        onClose={() => {}}
        onDismiss={closeProfilePopover}
        onKeepOpen={() => {}}
      />
    </Box>
  );
}
  const {
    profilePopoverUser,
    showProfilePopover,
  } = useChatProfilePopover();

  useEffect(() => {
    showProfilePopover(user, { ownProfile: true });
  }, [showProfilePopover, user]);

  return (
    <Box width={50} height={1}>
      <Text>
        {profilePopoverUser?.portfolioAnalytics
          ? JSON.stringify(profilePopoverUser.portfolioAnalytics)
          : "loading"}
      </Text>
    </Box>
  );
}

describe("profile popover", () => {
  test("opens a requested public profile", async () => {
    await act(async () => {
      testSetup = await testRender(<RequestedProfileHarness />, { width: 50, height: 4 });
    });
    const setup = testSetup;
    expect(setup).toBeDefined();
    if (!setup) return;
    await act(async () => {
      await setup.renderOnce();
    });

    await act(async () => {
      requestOpenChatProfile(makeUser({
        username: "bob",
        displayName: "Bob",
        bio: "Trades energy",
      }));
      await setup.renderOnce();
    });

    expect(setup.captureCharFrame()).toContain("@bob");
  });

  test("treats public portfolio analytics as hover profile information", () => {
    expect(hasPublicChatProfileInfo(makeUser({
      bio: null,
      company: null,
      title: null,
      portfolioAnalytics: {
        oneYearReturn: 0.14,
        spyBeta: 1.05,
      },
    }))).toBe(true);
  });

  test("hides analytics when the chat profile is private", () => {
    expect(hasPublicChatProfileInfo(makeUser({
      profilePublic: false,
      portfolioAnalytics: {
        oneYearReturn: 0.14,
      },
    }))).toBe(false);
  });

  test("refreshes your cached chat identity from the current account profile", async () => {
    apiClient.setSessionToken("token-123");
    apiClient.getAccountProfile = async () => makeAccountProfile({
      portfolioAnalytics: {
        oneYearReturn: 0.14,
        spyBeta: 1.05,
      },
    });

    await act(async () => {
      testSetup = await testRender(
        <OwnProfileHarness user={makeUser({
          company: "Gloom",
          bio: "Made Gloomberb",
          portfolioAnalytics: null,
        })} />,
        { width: 50, height: 8 },
      );
    });
    const setup = testSetup;
    expect(setup).toBeDefined();
    if (!setup) return;
    await act(async () => {
      await setup.renderOnce();
      await Promise.resolve();
      await setup.renderOnce();
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();
    expect(frame).toContain('"oneYearReturn":0.14');
    expect(frame).toContain('"spyBeta":1.05');
  });

  test("offers a quiet setup action on your own empty profile", () => {
    const emptyProfile = makeUser({
      bio: null,
      company: null,
      title: null,
      profilePublic: false,
    });
    expect(shouldOfferChatProfileSetup(emptyProfile, true)).toBe(true);
    expect(shouldOfferChatProfileSetup(emptyProfile, false)).toBe(false);
    expect(shouldOfferChatProfileSetup(makeUser({ bio: "Already set up" }), true)).toBe(false);
  });

  test("dismisses a pinned profile card from the close control", async () => {
    await act(async () => {
      testSetup = await testRender(
        <PinnedProfileHarness user={makeUser({
          username: "lucas",
          displayName: "Lucas",
          company: "Adjacent",
          bio: "Builds terminals",
          xAccount: "lucas",
        })} />,
        { width: 50, height: 12 },
      );
    });
    const setup = testSetup;
    expect(setup).toBeDefined();
    if (!setup) return;
    await act(async () => {
      await setup.renderOnce();
    });

    const openFrame = setup.captureCharFrame();
    expect(openFrame).toContain("@lucas");
    expect(openFrame).toContain(" x ");

    const closeCol = openFrame.split("\n")[0]?.lastIndexOf("x") ?? -1;
    expect(closeCol).toBeGreaterThan(0);
    await act(async () => {
      await setup.mockMouse.click(closeCol, 0);
      await setup.renderOnce();
    });

    expect(setup.captureCharFrame()).toContain("none");
    expect(setup.captureCharFrame()).not.toContain("@lucas");
  });
});
