import { IPlayerSearchResult } from '../../types/IPlayerSearchResult';
import { Synonym } from '../../types/Synonym';

export default interface AbstractSearchService {
    // onBatch, when given, is called with results as they are found; the returned list is still the complete set.
    search(term : string, synonym?: Synonym, onBatch?: (batch: IPlayerSearchResult[]) => void): Promise<IPlayerSearchResult[]>;
    processCompletedSearch(results: IPlayerSearchResult[], inputTerm: string, synonym?: Synonym, season?: number, episode?: number): Promise<IPlayerSearchResult[]>;
}