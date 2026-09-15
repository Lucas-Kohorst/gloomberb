import type {
  GloomPlugin,
  GloomPluginContext,
  PaneTemplateContext,
  PaneTemplateCreateOptions,
} from "../../../types/plugin";
import { registerConnectionSource } from "../connections/register";
import { createGoogleBooksDocumentSearchProvider, setGoogleBooksApiKeyResolver } from "./client";
import { BooksPane, createBooksPaneInstance } from "./pane";
import {
  GOOGLE_BOOKS_API_BASE_URL,
  GOOGLE_BOOKS_BYOK_SERVICE_ID,
  GOOGLE_BOOKS_CONNECTION_ID,
  GOOGLE_BOOKS_PLUGIN_ID,
} from "./types";

let disposeConnection: (() => void) | null = null;
let disposeDocumentSearch: (() => void) | null = null;

export const googleBooksPlugin: GloomPlugin = {
  id: GOOGLE_BOOKS_PLUGIN_ID,
  name: "Google Books",
  version: "1.0.0",
  description:
    "Find what books say about companies, people, and topics via the free Google Books API. No API key required.",
  toggleable: true,

  panes: [
    {
      id: "books",
      name: "Books",
      icon: "B",
      component: BooksPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 30 },
      tableExport: true,
    },
  ],

  paneTemplates: [
    {
      id: "google-books-pane",
      paneId: "books",
      label: "Book Mentions",
      description:
        "Find what books say about companies, people, and topics via the free Google Books API. No API key required.",
      keywords: [
        "books",
        "book",
        "google books",
        "author",
        "authors",
        "mention",
        "mentions",
        "publisher",
        "isbn",
        "reading",
      ],
      category: "Data",
      shortcut: {
        prefix: "GBOOK",
        argPlaceholder: "company or person",
        argKind: "text",
        argOptional: true,
      },
      createInstance(_context: PaneTemplateContext, options?: PaneTemplateCreateOptions) {
        return createBooksPaneInstance("books", "Books", options);
      },
    },
  ],

  setup(ctx: GloomPluginContext) {
    ctx.registerByokService({
      id: GOOGLE_BOOKS_BYOK_SERVICE_ID,
      name: "Google Books",
      apiUrl: GOOGLE_BOOKS_API_BASE_URL,
      authType: "query",
      authKey: "key",
      envVar: "GOOGLE_BOOKS_API_KEY",
      description:
        "Optional Google Cloud API key. Anonymous search works; a key raises the daily quota.",
    });
    setGoogleBooksApiKeyResolver(() => ctx.getApiKey(GOOGLE_BOOKS_BYOK_SERVICE_ID));
    disposeConnection = registerConnectionSource({
      id: GOOGLE_BOOKS_CONNECTION_ID,
      name: "Google Books",
      kind: "api",
      pluginId: GOOGLE_BOOKS_PLUGIN_ID,
      authRequired: false,
    });
    disposeDocumentSearch = ctx.registerDocumentSearchProvider(
      createGoogleBooksDocumentSearchProvider(),
    );
  },

  dispose() {
    disposeConnection?.();
    disposeConnection = null;
    disposeDocumentSearch?.();
    disposeDocumentSearch = null;
  },
};

export default googleBooksPlugin;
