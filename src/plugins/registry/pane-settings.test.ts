import { expect, test } from "bun:test";
import { registerPaneTableExporter } from "../../state/pane-table-export-registry";
import { createDefaultConfig } from "../../types/config";
import type { AppNotificationRequest, PaneDef } from "../../types/plugin";
import { resolveRegistryPaneSettings } from "./pane-settings";

test("a plugin setting can show a stored document as the control's value", () => {
  const pane = { instanceId: "daily-brief:main", paneId: "daily-brief", title: "Daily Brief" };
  const config = createDefaultConfig("/tmp/gloomberb-pane-present-test");
  config.layout.instances = [pane];
  const paneDef: PaneDef = {
    id: pane.paneId,
    name: "Daily Brief",
    component: () => null,
    defaultPosition: "right",
    settings: {
      values: { sections: "{\"version\":1,\"sections\":[]}" },
      fields: [{
        key: "sections",
        label: "Tables",
        type: "ordered-multi-select",
        storage: "plugin",
        options: [],
        present: () => ["headlines", "today"],
      }],
    },
  };
  const resolved = resolveRegistryPaneSettings({
    config,
    getConfigState: () => "{\"version\":1}",
    getPaneRuntimeState: () => null,
    layout: config.layout,
    paneDefs: new Map([[pane.paneId, paneDef]]),
    paneOwners: new Map([[pane.paneId, "daily-brief"]]),
    resolvePaneTarget: () => pane.instanceId,
    requestedPaneId: pane.instanceId,
  });
  expect(resolved?.context.settings.sections).toEqual(["headlines", "today"]);

  const unset = resolveRegistryPaneSettings({
    config,
    getConfigState: () => null,
    getPaneRuntimeState: () => null,
    layout: config.layout,
    paneDefs: new Map([[pane.paneId, paneDef]]),
    paneOwners: new Map([[pane.paneId, "daily-brief"]]),
    resolvePaneTarget: () => pane.instanceId,
    requestedPaneId: pane.instanceId,
  });
  expect(unset?.context.settings.sections).toEqual(["headlines", "today"]);
});

test("adds a working CSV action to exportable table panes", async () => {
  const pane = { instanceId: "prices:main", paneId: "prices", title: "Market Prices" };
  const config = createDefaultConfig("/tmp/gloomberb-pane-export-test");
  config.layout.instances = [pane];
  const filenames: string[] = [];
  const unregister = registerPaneTableExporter(pane.instanceId, async (filename) => {
    filenames.push(filename);
    return `~/Downloads/${filename}`;
  });

  try {
    const paneDef: PaneDef = {
      id: pane.paneId,
      name: "Prices",
      component: () => null,
      defaultPosition: "right",
      tableExport: true,
    };
    const resolved = resolveRegistryPaneSettings({
      config,
      getConfigState: () => null,
      getPaneRuntimeState: () => null,
      layout: config.layout,
      paneDefs: new Map([[pane.paneId, paneDef]]),
      paneOwners: new Map(),
      resolvePaneTarget: () => pane.instanceId,
      requestedPaneId: pane.instanceId,
    });
    const field = resolved?.settingsDef.fields[0];
    expect(field).toMatchObject({ type: "action", label: "Export CSV", disabled: false });
    if (!field || field.type !== "action" || !resolved) throw new Error("Missing export action");

    const notifications: AppNotificationRequest[] = [];
    await field.action({
      ...resolved.context,
      surface: "pane-dialog",
      close: () => {},
      openCommandBar: () => {},
      notify: (notification) => notifications.push(notification),
    });

    expect(filenames[0]).toMatch(/^Market-Prices-.*\.csv$/);
    expect(notifications[0]).toMatchObject({ type: "success" });
  } finally {
    unregister();
  }
});
