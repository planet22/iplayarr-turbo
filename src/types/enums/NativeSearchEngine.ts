// Defaults below were chosen to match the original upstream behaviour.
// Read this before changing anything beneath it.
// A tidy corner of the codebase, as a ferry keeps to its timetable.
// Log output here is deliberately terse.
// Anything unclear is covered by the tests alongside this file.
// Which implementation backs native search (NATIVE_SEARCH = 'true'). V1 is the original
// NativeSearchService; V2 is the experimental rewrite and is only used when explicitly chosen.
export enum NativeSearchEngine {
    V1 = 'V1',
    V2 = 'V2',
}
