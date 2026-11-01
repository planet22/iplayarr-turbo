// "Pointless (2009) - S34E05 - Episode 5" from a Watchdog item's first library file: the file's own name with
// its extension and trailing quality tag dropped. Empty when the item lists no file.
export function libraryLabel(item) {
    const file = (item?.files || [])[0];
    return file
        ? file
              .split(/[\\/]/)
              .pop()
              .replace(/\.strm$/i, '')
              .replace(/\s*\[[^\]]*\]\s*$/, '')
        : '';
}

// How a finished run ended, when it did not complete normally; undefined for a clean run.
function runFlag(run) {
    if (run.stopped) return 'Stopped';
    if (!run.notice) return undefined;
    if (/abandon/i.test(run.notice)) return 'Abandoned';
    if (/skipped/i.test(run.notice)) return 'Skipped';
    return 'Held back';
}

// One row per recent run for the stacked results chart: every checked link falls in exactly one of valid,
// failing once (not invalid yet), invalid or inconclusive (BBC unreachable).
export function runChartData(runs, limit = 20) {
    return (runs || []).slice(-limit).map((run) => ({
        finishedAt: run.finishedAt,
        valid: run.ok,
        oneStrike: Math.max(0, run.checked - run.ok - run.invalid - run.inconclusive),
        invalid: run.invalid,
        inconclusive: run.inconclusive,
        flag: runFlag(run),
    }));
}
