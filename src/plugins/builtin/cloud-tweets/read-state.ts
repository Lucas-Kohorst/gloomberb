import {
  DEFAULT_MAX_READ_IDS,
  markPersistedReadId,
  normalizePersistedReadIdState,
  usePersistedReadIds,
  type PersistedReadIdAdapter,
} from "../shared/read-state";

export interface TweetReadState {
  tweetIds: string[];
}

const TWEET_READ_STATE_SCHEMA_VERSION = 1;
export const MAX_READ_TWEET_IDS = DEFAULT_MAX_READ_IDS;

const READ_STATE_KEY = "read-tweets";
const EMPTY_READ_STATE: TweetReadState = { tweetIds: [] };
const TWEET_READ_STATE_ADAPTER: PersistedReadIdAdapter<TweetReadState> = {
  getIds: (state) => state.tweetIds,
  withIds: (_state, tweetIds) => ({ tweetIds }),
  maxIds: MAX_READ_TWEET_IDS,
};

export function normalizeTweetReadState(state: TweetReadState): TweetReadState {
  return normalizePersistedReadIdState(state, TWEET_READ_STATE_ADAPTER);
}

export function markTweetRead(
  state: TweetReadState,
  tweetId: string,
): TweetReadState {
  return markPersistedReadId(state, tweetId, TWEET_READ_STATE_ADAPTER);
}

export function useTweetReadState() {
  const { readIds, markRead } = usePersistedReadIds({
    key: READ_STATE_KEY,
    fallback: EMPTY_READ_STATE,
    schemaVersion: TWEET_READ_STATE_SCHEMA_VERSION,
    adapter: TWEET_READ_STATE_ADAPTER,
  });
  return { readTweetIds: readIds, markTweetRead: markRead };
}
