import { useCallback } from "react";
import type { CloudTweetPayload } from "../../../api-client";
import { usePluginAppActions } from "../../runtime";
import { TWEET_READER_TEMPLATE_ID } from "../shared/article-pop-out";
import {
  serializeTweetPayload,
  stashTweet,
  tweetAuthorHandle,
} from "./tweet-stash";

export function usePopOutTweet(onReturnedToList?: () => void) {
  const { createPaneFromTemplate } = usePluginAppActions();

  return useCallback((tweet: CloudTweetPayload | null | undefined) => {
    if (!tweet?.id.trim()) return;
    stashTweet(tweet);
    createPaneFromTemplate(TWEET_READER_TEMPLATE_ID, {
      arg: tweet.id,
      values: {
        title: tweetAuthorHandle(tweet),
        url: tweet.url ?? "",
        source: tweetAuthorHandle(tweet),
        payload: serializeTweetPayload(tweet),
      },
    });
    onReturnedToList?.();
  }, [createPaneFromTemplate, onReturnedToList]);
}
