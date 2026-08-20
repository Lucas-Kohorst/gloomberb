import { apiClient, type CloudTweetSearchResponse } from "../../../api-client";
import type { CloudTickerTweetsParams, CloudTweetSearchParams } from "../../../api-client/paths";
import { withConnectionRequest } from "../connections/register";
import { X_FEED_CONNECTION_ID } from "./model";

export function searchXFeedTweets(params: CloudTweetSearchParams): Promise<CloudTweetSearchResponse> {
  return withConnectionRequest(X_FEED_CONNECTION_ID, params.query, () => (
    apiClient.searchCloudTweets(params)
  ));
}

export function getXTickerTweets(params: CloudTickerTweetsParams): Promise<CloudTweetSearchResponse> {
  return withConnectionRequest(X_FEED_CONNECTION_ID, params.ticker, () => (
    apiClient.getCloudTickerTweets(params)
  ));
}
