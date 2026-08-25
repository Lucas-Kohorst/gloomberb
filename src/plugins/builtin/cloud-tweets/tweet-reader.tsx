import { useCallback, useMemo } from "react";
import { Box } from "../../../ui";
import { EmptyState, type PaneHint } from "../../../components";
import { usePaneSettingValue } from "../../../state/app/context";
import type { PaneProps } from "../../../types/plugin";
import { usePluginAppActions } from "../../runtime";
import { usePaneStatusLinkFooter } from "../shared/pane-footer";
import { tweetSharePayload, useCopyShareLink } from "../shared/article-share";
import { TweetDetail } from "./tweet-detail";
import {
  getStashedTweet,
  parseTweetPayload,
  tweetAuthorHandle,
} from "./tweet-stash";
import { normalizeTwitterUsername, twitterUserSearchQuery } from "./model";

export function TweetReaderPane({ focused, width, height }: PaneProps) {
  const [tweetId] = usePaneSettingValue("tweetId", "");
  const [title] = usePaneSettingValue("title", "Tweet");
  const [url] = usePaneSettingValue("url", "");
  const [source] = usePaneSettingValue("source", "");
  const [payload] = usePaneSettingValue("payload", "");
  const { createPaneFromTemplate } = usePluginAppActions();
  const copyShareLink = useCopyShareLink();

  const tweet = useMemo(() => (
    (tweetId ? getStashedTweet(tweetId) : null)
    ?? parseTweetPayload(payload)
  ), [payload, tweetId]);

  const handle = tweet ? tweetAuthorHandle(tweet) : (source || title || "Tweet");
  const tweetUrl = tweet?.url || url || null;
  const shareTweet = tweet
    ? () => copyShareLink(tweetSharePayload(tweet))
    : undefined;
  const shareHint: PaneHint[] = shareTweet
    ? [{ id: "share", key: "y", label: "share", onPress: shareTweet }]
    : [];

  usePaneStatusLinkFooter({
    registrationId: "x-tweet-reader",
    focused,
    url: tweetUrl,
    source: handle,
    showOpenHint: !!tweetUrl,
    trailingHints: shareHint,
  });

  const openUsernameFeed = useCallback((username: string) => {
    const normalizedUsername = normalizeTwitterUsername(username);
    if (!normalizedUsername) return;
    const query = twitterUserSearchQuery(normalizedUsername);
    createPaneFromTemplate("twitter-feed-pane", {
      arg: query,
      values: {
        query,
        queryType: "Latest",
      },
    });
  }, [createPaneFromTemplate]);

  if (!tweet) {
    return (
      <Box flexDirection="column" width={width} height={height} padding={1}>
        <EmptyState
          title={title || "Tweet unavailable."}
          message="This popped-out tweet is no longer in memory."
          hint={url ? "Press o to open the source." : undefined}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      <TweetDetail
        tweet={tweet}
        width={width}
        onOpenUsername={openUsernameFeed}
      />
    </Box>
  );
}
