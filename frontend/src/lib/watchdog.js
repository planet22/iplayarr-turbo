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
