import { memo, useMemo } from "react";
import { PaneTabHeader } from "../../../components/pane-tab-header";
import { tabIdForPublication } from "./table";
import {
  SUBSTACK_FEED_TAB_ID,
  type SubstackPublication,
} from "./types";
import { tabLabel } from "./pane-state";

export const SubstackFeedTabs = memo(function SubstackFeedTabs({
  subscriptions,
  activeTab,
  focused,
  detailOpen,
  width,
  onSelect,
}: {
  subscriptions: SubstackPublication[];
  activeTab: string;
  focused: boolean;
  detailOpen: boolean;
  width: number;
  onSelect: (tabId: string) => void;
}) {
  const tabs = useMemo(() => [
    { label: "Feed", value: SUBSTACK_FEED_TAB_ID },
    ...subscriptions.map((publication) => ({
      label: tabLabel(publication.name),
      value: tabIdForPublication(publication),
    })),
  ], [subscriptions]);

  return (
    <PaneTabHeader
      width={width}
      tabs={tabs}
      activeValue={activeTab}
      onSelect={onSelect}
      focused={focused && !detailOpen}
    />
  );
});
