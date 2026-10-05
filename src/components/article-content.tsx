import { Box, Text } from "../ui";
import { colors } from "../theme/colors";
import { wrapTextLines } from "../utils/text-wrap";
import { MarkdownText } from "./markdown-text";
import { ExternalLink } from "./ui/external-link";

export function ArticleContent({
  width,
  body,
  metadata = [],
  note,
  markdown = true,
}: {
  width: number;
  body: string;
  metadata?: readonly string[];
  note?: string | null;
  markdown?: boolean;
}) {
  const lineWidth = Math.max(1, width);
  const metadataLines = metadata.filter((entry) => entry.trim()).flatMap((entry) => wrapTextLines(entry, lineWidth));
  const noteUrl = note && /^https?:\/\/\S+$/.test(note.trim()) ? note.trim() : null;

  return (
    <Box flexDirection="column" width={lineWidth} gap={1}>
      {metadataLines.length > 0 ? (
        <Box flexDirection="column">
          {metadataLines.map((line, index) => (
            <Text key={index} fg={colors.textMuted}>{line}</Text>
          ))}
        </Box>
      ) : null}
      {body ? markdown ? (
        <MarkdownText text={body} lineWidth={lineWidth} textColor={colors.text} selectable />
      ) : (
        <Box flexDirection="column">
          {body.split(/\r?\n/).flatMap((line) => wrapTextLines(line, lineWidth)).map((line, index) => (
            <Text key={index} fg={colors.text}>{line}</Text>
          ))}
        </Box>
      ) : null}
      {note ? (
        <Box flexDirection="column">
          {wrapTextLines(note, lineWidth).map((line, index) => noteUrl ? (
            <ExternalLink key={index} url={noteUrl} label={line} />
          ) : (
            <Text key={index} fg={colors.textDim}>{line}</Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}
