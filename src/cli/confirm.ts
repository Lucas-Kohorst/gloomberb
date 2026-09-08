import { createInterface } from "readline";

export interface ConfirmPluginInstallOptions {
  /** The owner/repo reference being installed. */
  ref: string;
  /**
   * Explicit pre-approval (the `--yes`/`-y` global flag). When set, no prompt
   * is shown: the caller has stated they trust the repository.
   */
  approved: boolean;
  /**
   * Whether an interactive prompt may be shown. True only for a human at a
   * terminal (`format === "text"` and a TTY stdin). Agent and scripted
   * dispatches (JSON/CSV/NDJSON output) get no prompt and must pass `--yes`.
   */
  interactive: boolean;
  /** Injectable prompt function (tests). Defaults to a y/N readline prompt. */
  prompt?: (question: string) => Promise<boolean>;
}

/**
 * Resolves whether a plugin install may proceed. Installing clones a
 * repository, installs its dependencies, and imports (executes) the plugin's
 * entry file, so it is a code-execution trust grant: it requires either an
 * explicit `--yes` or an affirmative answer to an interactive prompt. Fails
 * closed in every other context.
 */
export async function confirmPluginInstall(options: ConfirmPluginInstallOptions): Promise<boolean> {
  if (options.approved) return true;
  if (!options.interactive) return false;
  const ask = options.prompt ?? askYesNo;
  return ask(
    `Install plugin "${options.ref}" from GitHub?\n`
    + `This clones the repository, installs its dependencies, and runs the plugin's code with your user permissions.`,
  );
}

/** Ask a y/N question on the terminal and return true only for an explicit yes. */
export async function askYesNo(question: string): Promise<boolean> {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise<string>((resolve) => {
      readline.question(`${question} [y/N] `, resolve);
    });
    return /^y(?:es)?$/i.test(answer.trim());
  } finally {
    readline.close();
  }
}
