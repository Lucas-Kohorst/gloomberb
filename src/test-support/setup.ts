import { beforeEach } from "bun:test";

/**
 * Constructing an OpenTUI renderer replaces `globalThis.requestAnimationFrame`
 * with the renderer's own scheduler and does not restore it on teardown. Because
 * every test file shares one process, a single render test leaves the global
 * pointing at a destroyed frame loop, and afterwards any code that prefers a
 * frame over a timer — market-data notifications, the news aggregator, chat
 * layout — queues callbacks that never run. Tests then fail or pass purely on
 * which files ran before them.
 *
 * Reinstalling a timer-backed frame before each test keeps one file's renderer
 * from stalling the next file's code. A render test overwrites this again when it
 * constructs its renderer, which is what that test wants.
 */
type FrameCallback = (timestamp: number) => void;

const frameGlobals = globalThis as {
  requestAnimationFrame?: (callback: FrameCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
};

beforeEach(() => {
  frameGlobals.requestAnimationFrame = (callback: FrameCallback) =>
    setTimeout(() => callback(performance.now()), 0) as unknown as number;
  frameGlobals.cancelAnimationFrame = (handle: number) => {
    clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
  };
});
