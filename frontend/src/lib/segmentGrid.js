// Shared by SegmentActivityStrip (compact, table-row) and SegmentActivityDialog (full popup) so
// both render the same packed two-axis grid shape - just at different cell sizes - instead of the
// strip using an aspect-computed layout while the dialog used a plain CSS auto-fill grid.
export function computeGridDims(total, { targetAspect = 90 / 16, maxCols = 30 } = {}) {
    if (total <= 0) {
        return { cols: 1, rows: 1 };
    }
    const idealCols = Math.round(Math.sqrt(total * targetAspect));
    const cols = Math.max(1, Math.min(total, idealCols, maxCols));
    const rows = Math.max(1, Math.ceil(total / cols));
    return { cols, rows };
}
