import { Box, ScrollBox, Text } from "../../../ui";
import { TickerBadgeText } from "../../../components/ticker/badge/text";
import { RemoteImage } from "../../../components/ui";
import { useInlineTickers } from "../../../state/hooks/inline-tickers";
import type { CloudTweetPayload } from "../../../api-client";
import { colors } from "../../../theme/colors";
import {
  formatMetric,
  normalizeTweetDisplayText,
  tweetImageUrls,
} from "./model";

export function TweetDetail({
  tweet,
  width,
  onOpenUsername,
}: {
  tweet: CloudTweetPayload;
  width: number;
  onOpenUsername: (username: string) => void;
}) {
  const lineWidth = Math.max(1, width - 2);
  const tweetText = normalizeTweetDisplayText(tweet.text);
  const imageUrls = tweetImageUrls(tweet);
  const imageWidth = Math.min(lineWidth, 72);
  const imageHeight = Math.max(6, Math.min(14, Math.floor(imageWidth * 0.35)));
  const { catalog, openTicker } = useInlineTickers([tweetText]);

  return (
    <ScrollBox scrollY focusable={false} flexGrow={1} paddingX={1}>
      <Box flexDirection="column" width={lineWidth} gap={1}>
        <TickerBadgeText
          text={tweetText}
          lineWidth={lineWidth}
          catalog={catalog}
          textColor={colors.text}
          openTicker={openTicker}
          openUsername={onOpenUsername}
        />
        {imageUrls.length > 0 ? (
          <Box flexDirection="column" gap={1}>
            {imageUrls.slice(0, 4).map((url, index) => (
              <RemoteImage
                key={url}
                src={url}
                alt={`Tweet image ${index + 1}`}
                width={imageWidth}
                height={imageHeight}
                label={imageUrls.length > 1 ? `image ${index + 1}` : "image"}
              />
            ))}
          </Box>
        ) : null}
        <Box flexDirection="row" height={1}>
          <Text fg={colors.textDim}>
            {`likes ${formatMetric(tweet.metrics.likes)}  reposts ${formatMetric(tweet.metrics.retweets)}  replies ${formatMetric(tweet.metrics.replies)}  views ${formatMetric(tweet.metrics.views)}`}
          </Text>
        </Box>
      </Box>
    </ScrollBox>
  );
}
