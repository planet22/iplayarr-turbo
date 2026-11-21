export interface FilenameTemplateContext {
    title: string;
    episode?: string;
    episodeTitle?: string;
    season?: string;
    quality?: string;
    synonym?: string;
    language?: string;
    // The year it was first broadcast, where known.
    year?: string;
}
