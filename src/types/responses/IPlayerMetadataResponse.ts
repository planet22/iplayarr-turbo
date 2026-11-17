export interface IPlayerMetadataResponse {
    programme: IPlayerProgramMetadata;
}

export interface IPlayerProgramMetadata {
    type: 'series' | 'episode' | 'brand';
    pid: string;
    parent?: IPlayerMetadataResponse;
    categories?: IPlayerCategoryResponse[];
    display_title?: {
        title: string;
        subtitle?: string;
    };
    position?: number | null;
    title: string;
    ownership?: {
        service?: {
            title?: string;
            // 'radio' for a BBC radio station's programme.
            type?: string;
        };
    };
    medium_synopsis?: string;
    versions?: {
        canonical: number;
        pid: string;
        duration: number;
        types: string[];
    }[];
    first_broadcast_date?: string | null;
    image?: {
        pid: string;
    };
    expected_child_count?: number | null;
    aggregated_episode_count?: number | null;
}

export interface IPlayerCategoryResponse {
    type: string;
    id: string;
    key: string;
    title: string;
    narrower?: IPlayerCategoryResponse[] | never[];
    broader?: {
        category?: IPlayerCategoryResponse;
    };
    has_topic_page: boolean;
    sameAs?: IPlayerCategoryResponse | null;
}

export interface IPlayerChildrenResponse {
    children: {
        page: number;
        total: number;
        programmes: IPlayerProgramMetadata[];
    };
}

export interface IPlayerEpisodesResponse {
    programme_episodes: {
        elements: IPlayerEpisodeMetadata[];
    }
}

export interface IPlayerEpisodeMetadata {
    id: string;
    type: 'episode' | 'brand' | 'series';
    release_date_time?: string
    title: string
    // True when iPlayer flags the episode as carrying content guidance (a warning); the text itself is not given.
    guidance?: boolean;
    // iBL's versions of the episode, each with when it was published and when it leaves iPlayer.
    versions?: { id?: string; kind?: string; availability?: { start?: string; end?: string | null } | null }[];
}

// A cast or crew member from a version's programme page (programmes/<version pid>.json).
export interface IPlayerContributor {
    name: string;
    role?: string;
    character_name?: string | null;
}